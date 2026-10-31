// Tokens spent by smart runs today, across every session and app restart. Kept per local date,
// so the daily cap resets at local midnight.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface CapState {
  allowed: boolean
  used: number
  cap: number
}

export interface Usage {
  check(): Promise<CapState>
  add(tokens: number): Promise<void>
}

interface Day {
  date: string
  tokens: number
}

export function localDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function createUsage(options: { path: string; cap: number; now?: () => Date }): Usage {
  const now = options.now ?? (() => new Date())
  let day: Day | undefined
  let writing: Promise<void> = Promise.resolve()

  async function load(today: string): Promise<Day> {
    try {
      const saved = JSON.parse(await readFile(options.path, 'utf8')) as Partial<Day>
      if (saved.date === today && typeof saved.tokens === 'number') {
        return { date: today, tokens: saved.tokens }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('tapet: ignoring unreadable token usage', error)
      }
    }

    return { date: today, tokens: 0 }
  }

  async function today(): Promise<Day> {
    const date = localDate(now())
    if (day?.date !== date) {
      day = await load(date)
    }

    return day
  }

  return {
    async check() {
      const { tokens } = await today()
      return { allowed: tokens < options.cap, used: tokens, cap: options.cap }
    },

    async add(tokens) {
      const current = await today()
      current.tokens += tokens
      const snapshot = JSON.stringify(current)
      writing = writing
        .then(async () => {
          await mkdir(dirname(options.path), { recursive: true })
          await writeFile(options.path, `${snapshot}\n`)
        })
        .catch((error: unknown) => {
          console.error('tapet: cannot save token usage', error)
        })
      await writing
    },
  }
}
