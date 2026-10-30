// The log view's lines and search, without any DOM, so it's tested on its own.
import type { Change, Entry, EntryKey } from '@tapet/core'

export interface LogLine {
  key: EntryKey
  text: string
  // Lowercased text without terminal color codes, for searching.
  plain: string
}

// eslint-disable-next-line no-control-regex
const ANSI_CODES = /\u001b\[[0-9;?]*[ -/]*[@-~]/g

function toLine(entry: Entry): LogLine {
  const text = typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value)
  return { key: entry.key, text, plain: text.replace(ANSI_CODES, '').toLowerCase() }
}

export interface LogModel {
  // The lines to show: all of them, or only those matching the search.
  readonly lines: LogLine[]
  readonly total: number
  apply(change: Change): void
  search(query: string): void
}

export function createLogModel(entries: Entry[]): LogModel {
  let lines = entries.map(toLine)
  let query = ''
  let matching = lines
  const matches = (line: LogLine) => line.plain.includes(query)

  return {
    get lines() {
      return matching
    },

    get total() {
      return lines.length
    },

    apply(change) {
      const reshaped = change.removed.length > 0 || change.updated.length > 0
      if (reshaped) {
        const removed = new Set(change.removed)
        const updated = new Map(change.updated.map((entry) => [entry.key, toLine(entry)]))
        lines = lines.flatMap((line) =>
          removed.has(line.key) ? [] : [updated.get(line.key) ?? line],
        )
      }

      const added = change.added.map(toLine)
      for (const line of added) {
        lines.push(line)
      }

      if (!query) {
        matching = lines
        return
      }

      if (reshaped) {
        matching = lines.filter(matches)
        return
      }

      for (const line of added.filter(matches)) {
        matching.push(line)
      }
    },

    search(next) {
      query = next.toLowerCase()
      matching = query ? lines.filter(matches) : lines
    },
  }
}
