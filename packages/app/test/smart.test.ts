import { MockLanguageModelV4 } from 'ai/test'
import { afterEach, expect, it, vi } from 'vitest'
import { createStore, type Store } from '@tapet/core'
import type { SessionConfig, SmartView } from '@tapet/protocol'
import { createSmart, type SmartHost } from '../src/session/smart.ts'

// A model that answers with the given texts in turn, and records each prompt it saw.
function mockModel(texts: string[] = [], gate?: Promise<void>) {
  const prompts: string[] = []
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      prompts.push(JSON.stringify(options.prompt))
      await gate
      return {
        content: [{ type: 'text', text: texts.shift() ?? 'ok' }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 5, text: 5, reasoning: undefined },
        },
        warnings: [],
      }
    },
  })
  return { model, prompts }
}

function setup(
  options: {
    texts?: string[]
    gate?: Promise<void>
    host?: Partial<SmartHost>
    budget?: number
  } = {},
) {
  const { model, prompts } = mockModel(options.texts, options.gate)
  const config: SessionConfig = {
    providers: {},
    models: ['openai/fake'],
    default_model: 'openai/fake',
    smart_input_tokens: options.budget ?? 50_000,
    window_focus: 'never',
    ended_panels: 'keep',
  }
  const notices: string[] = []
  const tokens: number[] = []
  const views: SmartView[] = []
  const smart = createSmart({
    config: () => config,
    modelFor: () => model,
    capCheck: async () => ({ allowed: true, used: 0, cap: 1_000_000 }),
    tokensUsed: (count) => tokens.push(count),
    update: (_panel, view) => views.push(view),
    notice: (message) => notices.push(message),
    log: () => undefined,
    ...options.host,
  })
  const store = createStore({ update: 'append', retention: 'all' })
  const write = (...lines: string[]) => smart.onChange('log', store.apply(lines, Date.now()).change)
  return { smart, store, write, prompts, notices, tokens, views }
}

afterEach(() => {
  vi.useRealTimers()
})

function attach(
  smart: ReturnType<typeof setup>['smart'],
  store: Store,
  settings: Parameters<typeof smart.set>[1],
) {
  smart.set('log', settings, store)
}

it('runs after every N new items, and remembers its outputs and tokens', async () => {
  const { smart, store, write, tokens } = setup({ texts: ['**two errors**'] })
  attach(smart, store, { prompt: 'Summarize errors', every: { items: 3 } })
  write('error a', 'ok')
  expect(smart.read('log', 1)).toEqual([])

  write('error b')
  await vi.waitFor(() => expect(smart.read('log', 1)).toHaveLength(1))
  expect(smart.read('log', 1)[0]).toMatchObject({
    text: '**two errors**',
    model: 'openai/fake',
    tokens: 15,
  })
  expect(tokens).toEqual([15])
  expect(smart.view('log')).toMatchObject({ status: 'idle', latest: { text: '**two errors**' } })
})

it('sees its previous output and only the items that are new since', async () => {
  const { smart, store, write, prompts } = setup({ texts: ['first summary', 'second summary'] })
  attach(smart, store, { prompt: 'Summarize', every: { items: 2 } })
  write('old one', 'old two')
  await vi.waitFor(() => expect(smart.read('log', 5)).toHaveLength(1))

  write('new one', 'new two')
  await vi.waitFor(() => expect(smart.read('log', 5)).toHaveLength(2))
  const second = prompts.at(-1) ?? ''
  expect(second).toContain('first summary')
  expect(second).toContain('new one')
  expect(second).not.toContain('old one')
})

it('runs on its timer only when something new arrived', async () => {
  vi.useFakeTimers()
  const { smart, store, write, prompts } = setup()
  attach(smart, store, { prompt: 'Summarize', every: { seconds: 1 } })
  await vi.advanceTimersByTimeAsync(1500)
  expect(prompts).toHaveLength(0)

  write('something')
  await vi.advanceTimersByTimeAsync(1000)
  expect(prompts).toHaveLength(1)
})

it('summarizes items that overflow the token budget, in chunks', async () => {
  const { smart, store, write, prompts } = setup({ budget: 1000 })
  attach(smart, store, { prompt: 'Summarize' })
  write(...Array.from({ length: 30 }, (_, index) => `line ${index} ${'x'.repeat(390)}`))
  await smart.run('log')
  expect(prompts.length).toBeGreaterThan(2)
  expect(prompts.at(-1)).toContain("Summaries of earlier items that didn't fit")
  expect(prompts.at(-1)).toContain('line 29')
})

it('stops at the daily cap, with a single notice', async () => {
  const { smart, store, notices } = setup({
    host: { capCheck: async () => ({ allowed: false, used: 10, cap: 10 }) },
  })
  attach(smart, store, { prompt: 'Summarize' })
  expect(await smart.run('log')).toMatchObject({
    error: expect.stringContaining('daily token cap'),
  })
  await smart.run('log')
  expect(smart.view('log')?.status).toBe('cap reached')
  expect(notices).toHaveLength(1)
})

it("turns model errors, like a missing key, into the run's output and a notice", async () => {
  const { smart, store, notices } = setup({
    host: {
      modelFor: () => {
        throw new Error('no API key for openai')
      },
    },
  })
  attach(smart, store, { prompt: 'Summarize' })
  expect(await smart.run('log')).toMatchObject({ error: 'no API key for openai' })
  expect(notices).toEqual([expect.stringContaining('no API key for openai')])
})

it('skips triggers during a run, and smart_run waits for it before running again', async () => {
  let release = () => undefined as void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const { smart, store, write, prompts } = setup({ gate })
  attach(smart, store, { prompt: 'Summarize', every: { items: 1 } })
  write('a')
  write('b')
  await vi.waitFor(() => expect(prompts).toHaveLength(1))

  const manual = smart.run('log')
  release()
  await manual
  expect(prompts).toHaveLength(2)
})
