// The smart trait: an LLM that reads a panel's new data and keeps a rolling output.
import { generateText, type LanguageModel, type LanguageModelUsage } from 'ai'
import type { Change, SmartSettings, Store } from '@tapet/core'
import type { SessionConfig, SmartOutput, SmartStatus, SmartView } from '@tapet/protocol'

export interface SmartHost {
  config(): SessionConfig
  modelFor(id: string): LanguageModel
  capCheck(): Promise<{ allowed: boolean; used: number; cap: number }>
  tokensUsed(tokens: number): void
  // Tells the window about a panel's smart status and latest output.
  update(panelId: string, view: SmartView): void
  notice(message: string): void
  log(event: string, details?: Record<string, unknown>): void
}

export interface Smart {
  // Adds, changes or (with no settings) removes a panel's smart trait. Outputs survive changes.
  set(panelId: string, settings: SmartSettings | undefined, store: Store): void
  remove(panelId: string): void
  // Counts new data toward the panel's triggers.
  onChange(panelId: string, change: Change): void
  // Runs now, after any run in progress, even with nothing new.
  run(panelId: string): Promise<SmartOutput>
  read(panelId: string, last: number): SmartOutput[]
  view(panelId: string): SmartView | undefined
  has(panelId: string): boolean
  // Stops and restarts timed runs, while the session is ended.
  pause(): void
  resume(): void
}

interface Runner {
  settings: SmartSettings
  store: Store
  outputs: SmartOutput[]
  status: SmartStatus
  // Entries with a higher seq are new since the last successful run.
  lastSeq: number
  pendingItems: number
  pendingChars: number
  running?: Promise<SmartOutput>
  timer?: ReturnType<typeof setInterval>
}

// Tokens are estimated, not counted: about 4 characters each.
export const CHARS_PER_TOKEN = 4
// A burst far beyond the budget is summarized in at most this many chunks; older items are skipped.
export const MAX_SUMMARY_CHUNKS = 5

const SYSTEM = `You are the smart assistant of a tapet panel: a live view of a data stream, shown to a user. Follow the instructions about the panel's data. Answer in concise markdown. You only see the data included here.`
const SUMMARY_SYSTEM = `Summarize these items from a data stream concisely, keeping counts, errors and anything unusual. Another model will read your summary alongside newer items.`

export function itemText(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  if (value instanceof Uint8Array) {
    return new TextDecoder().decode(value)
  }

  return JSON.stringify(value)
}

function totalTokens(usage: LanguageModelUsage): number {
  return usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
}

// Keeps the newest items that fit in the room; the rest overflow.
function fit(items: string[], room: number): { kept: string[]; overflow: string[] } {
  let used = 0
  let start = items.length
  while (start > 0) {
    const size = (items[start - 1]?.length ?? 0) + 1
    if (used + size > room) {
      break
    }

    used += size
    start -= 1
  }

  return { kept: items.slice(start), overflow: items.slice(0, start) }
}

// Groups items into chunks of at most `size` characters. A single huge item is cut to size.
function chunks(items: string[], size: number): string[][] {
  const result: string[][] = []
  let current: string[] = []
  let used = 0
  for (const item of items.map((text) => text.slice(0, size))) {
    if (used + item.length + 1 > size && current.length > 0) {
      result.push(current)
      current = []
      used = 0
    }

    current.push(item)
    used += item.length + 1
  }

  if (current.length > 0) {
    result.push(current)
  }

  return result
}

function prompt(
  instructions: string,
  history: SmartOutput[],
  summaries: string[],
  skipped: number,
  items: string[],
): string {
  const sections = [`## Instructions\n\n${instructions}`]
  if (history.length > 0) {
    const outputs = history.map(
      (output) => `### ${new Date(output.at).toISOString()}\n\n${output.text}`,
    )
    sections.push(`## Your previous outputs (oldest first)\n\n${outputs.join('\n\n')}`)
  }

  if (summaries.length > 0 || skipped > 0) {
    const note = skipped > 0 ? `\n\n(${skipped} even older items were skipped.)` : ''
    sections.push(
      `## Summaries of earlier items that didn't fit\n\n${summaries.join('\n\n')}${note}`,
    )
  }

  sections.push(
    `## New items since your last run (oldest first)\n\n${items.length > 0 ? items.join('\n') : '(none)'}`,
  )
  return sections.join('\n\n')
}

export function createSmart(host: SmartHost): Smart {
  const runners = new Map<string, Runner>()
  let paused = false

  function view(runner: Runner): SmartView {
    const latest = runner.outputs.at(-1)
    return latest ? { status: runner.status, latest } : { status: runner.status }
  }

  function publish(panelId: string, runner: Runner) {
    host.update(panelId, view(runner))
  }

  function schedule(panelId: string, runner: Runner) {
    clearInterval(runner.timer)
    runner.timer = undefined
    const { every } = runner.settings
    if (paused || !every || !('seconds' in every)) {
      return
    }

    runner.timer = setInterval(() => {
      if (runner.pendingItems > 0) {
        trigger(panelId)
      }
    }, every.seconds * 1000)
  }

  // Starts a run unless one is in progress, in which case the trigger is skipped: the next run
  // covers everything since the last one anyway.
  function trigger(panelId: string) {
    const runner = runners.get(panelId)
    if (!runner || runner.running || paused) {
      return
    }

    void start(panelId, runner)
  }

  function start(panelId: string, runner: Runner): Promise<SmartOutput> {
    const running = execute(panelId, runner).finally(() => {
      if (runner.running === running) {
        runner.running = undefined
      }
    })
    runner.running = running
    return running
  }

  async function execute(panelId: string, runner: Runner): Promise<SmartOutput> {
    const config = host.config()
    const model = runner.settings.model ?? config.default_model
    const failure = (error: string, status: SmartStatus = 'error'): SmartOutput => {
      const previous = runner.outputs.at(-1)
      const output: SmartOutput = { at: Date.now(), model: model ?? '', tokens: 0, error }
      // Repeating the same failure, like the cap on every trigger, would only bury the agent in notices.
      if (runner.status !== status || previous?.error !== error) {
        host.notice(`a smart run for panel "${panelId}" failed: ${error}`)
      }

      runner.outputs.push(output)
      runner.status = status
      publish(panelId, runner)
      host.log('smart run failed', { panel: panelId, error })
      return output
    }

    if (!model) {
      return failure(
        'no model: set smart.model, or default_model in your tapet config (docs_get "config")',
      )
    }

    if (!config.models.includes(model)) {
      return failure(
        `model "${model}" isn't in your tapet config; models_get lists the configured models`,
      )
    }

    const cap = await host.capCheck()
    if (!cap.allowed) {
      return failure(
        `the daily token cap (${cap.cap}) is reached; smart runs resume at local midnight`,
        'cap reached',
      )
    }

    runner.status = 'running'
    publish(panelId, runner)
    const fresh = runner.store.entries().filter((entry) => entry.seq > runner.lastSeq)
    const highest = fresh.reduce((max, entry) => Math.max(max, entry.seq), runner.lastSeq)
    runner.pendingItems = 0
    runner.pendingChars = 0

    const budget = config.smart_input_tokens * CHARS_PER_TOKEN
    const history = runner.outputs
      .filter((output) => output.text !== undefined)
      .slice(-(runner.settings.history ?? 1))
    while (
      history.length > 0 &&
      history.reduce((size, output) => size + (output.text?.length ?? 0), 0) > budget / 2
    ) {
      history.shift()
    }

    const room = budget - history.reduce((size, output) => size + (output.text?.length ?? 0), 0)
    const { kept, overflow } = fit(
      fresh.map((entry) => itemText(entry.value)),
      room,
    )
    const parts = chunks(overflow, room)
    const summarized = parts.slice(-MAX_SUMMARY_CHUNKS)
    const skipped = parts
      .slice(0, -MAX_SUMMARY_CHUNKS)
      .reduce((count, part) => count + part.length, 0)
    let tokens = 0
    try {
      const languageModel = host.modelFor(model)
      const summaries: string[] = []
      for (const part of summarized) {
        const summary = await generateText({
          model: languageModel,
          system: SUMMARY_SYSTEM,
          prompt: part.join('\n'),
        })
        tokens += totalTokens(summary.usage)
        summaries.push(summary.text)
      }

      const result = await generateText({
        model: languageModel,
        system: SYSTEM,
        prompt: prompt(runner.settings.prompt, history, summaries, skipped, kept),
      })
      tokens += totalTokens(result.usage)
      host.tokensUsed(tokens)
      runner.lastSeq = highest
      const output: SmartOutput = { at: Date.now(), model, tokens, text: result.text }
      runner.outputs.push(output)
      runner.status = 'idle'
      publish(panelId, runner)
      host.log('smart run', {
        panel: panelId,
        model,
        tokens,
        items: fresh.length,
        summarized: overflow.length,
      })
      return output
    } catch (error) {
      if (tokens > 0) {
        host.tokensUsed(tokens)
      }

      return failure(error instanceof Error ? error.message : String(error))
    }
  }

  function remove(panelId: string) {
    clearInterval(runners.get(panelId)?.timer)
    runners.delete(panelId)
  }

  return {
    set(panelId, settings, store) {
      if (!settings) {
        remove(panelId)
        return
      }

      const existing = runners.get(panelId)
      const runner: Runner = existing
        ? { ...existing, settings, store }
        : {
            settings,
            store,
            outputs: [],
            status: 'idle',
            lastSeq: 0,
            pendingItems: 0,
            pendingChars: 0,
          }
      clearInterval(existing?.timer)
      runners.set(panelId, runner)
      schedule(panelId, runner)
      if (!existing) {
        publish(panelId, runner)
      }
    },

    remove,

    onChange(panelId, change) {
      const runner = runners.get(panelId)
      if (!runner) {
        return
      }

      const touched = [...change.added, ...change.updated]
      runner.pendingItems += touched.length
      runner.pendingChars += touched.reduce(
        (size, entry) => size + itemText(entry.value).length + 1,
        0,
      )
      const { every } = runner.settings
      if (!every) {
        return
      }

      const overBudget = runner.pendingChars >= host.config().smart_input_tokens * CHARS_PER_TOKEN
      if (overBudget || ('items' in every && runner.pendingItems >= every.items)) {
        trigger(panelId)
      }
    },

    async run(panelId) {
      const runner = runners.get(panelId)
      if (!runner) {
        throw new Error(`panel "${panelId}" has no smart trait`)
      }

      await runner.running
      return await start(panelId, runner)
    },

    read(panelId, last) {
      return runners.get(panelId)?.outputs.slice(-last) ?? []
    },

    view(panelId) {
      const runner = runners.get(panelId)
      return runner ? view(runner) : undefined
    },

    has(panelId) {
      return runners.has(panelId)
    },

    pause() {
      paused = true
      for (const runner of runners.values()) {
        clearInterval(runner.timer)
        runner.timer = undefined
      }
    },

    resume() {
      paused = false
      for (const [panelId, runner] of runners) {
        schedule(panelId, runner)
      }
    },
  }
}
