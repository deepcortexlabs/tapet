// The table view's columns, rows and sorting, without any DOM, so it's tested on its own.
import type { Change, Entry, EntryKey } from '@tapet/core'

export interface TableRow {
  key: EntryKey
  value: unknown
}

export interface Sorting {
  column: number
  descending: boolean
}

export interface TableModel {
  readonly columns: string[]
  // Each column's width in characters, from the header and the first rows. Widths only grow, so
  // columns don't jump around while data streams in.
  readonly widths: number[]
  // In arrival order, or sorted.
  readonly rows: TableRow[]
  readonly sorting: Sorting | undefined
  apply(change: Change): void
  // The agent's table.columns, or undefined to take the columns from the data.
  setColumns(columns: string[] | undefined): void
  // Sorts by a column: ascending, then descending, then back to arrival order.
  sort(column: number): void
  cell(row: TableRow, column: number): string
}

const MEASURED_ROWS = 200
const MIN_WIDTH = 4
const MAX_WIDTH = 40
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function clampWidth(length: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, length))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function formatCell(value: unknown): string {
  if (value === undefined || value === null) {
    return ''
  }

  if (typeof value === 'string') {
    return value
  }

  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

function isMissing(value: unknown): boolean {
  return value === undefined || value === null || value === ''
}

// Numbers compare as numbers, everything else as text with numeric collation, so CSV values like
// "9" and "10" sort the way people expect.
function compare(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b
  }

  return collator.compare(formatCell(a), formatCell(b))
}

export function createTableModel(entries: Entry[], explicit?: string[]): TableModel {
  let rows: TableRow[] = []
  let inferred: string[] = []
  let columns = explicit ?? inferred
  let widths: number[] = []
  let measured = 0
  let sorting: Sorting | undefined
  let sorted: TableRow[] | undefined

  // A row's value in a column: objects by field name, arrays (csv without a header) by position,
  // and anything else in the first column.
  function valueAt(row: TableRow, column: number): unknown {
    const { value } = row
    if (Array.isArray(value)) {
      return value[column]
    }

    if (isRecord(value)) {
      const name = columns[column]
      return name === undefined ? undefined : value[name]
    }

    return column === 0 ? value : undefined
  }

  // Columns in order of first appearance: object fields, or numbered positions for arrays.
  function infer(value: unknown) {
    if (isRecord(value)) {
      for (const name of Object.keys(value)) {
        if (!inferred.includes(name)) {
          inferred.push(name)
        }
      }

      return
    }

    if (!Array.isArray(value)) {
      if (inferred.length === 0) {
        inferred.push('value')
      }

      return
    }

    while (inferred.length < value.length) {
      inferred.push(String(inferred.length + 1))
    }
  }

  function measure(row: TableRow) {
    columns.forEach((name, column) => {
      const width = clampWidth(Math.max(name.length, formatCell(valueAt(row, column)).length))
      widths[column] = Math.max(widths[column] ?? MIN_WIDTH, width)
    })
  }

  function remeasure() {
    widths = []
    measured = 0
    for (const row of rows.slice(0, MEASURED_ROWS)) {
      measure(row)
      measured += 1
    }
  }

  function add(entries: Entry[]) {
    for (const entry of entries) {
      const row = { key: entry.key, value: entry.value }
      if (!explicit) {
        infer(entry.value)
      }

      if (measured < MEASURED_ROWS) {
        measure(row)
        measured += 1
      }

      rows.push(row)
    }
  }

  function sortRows(): TableRow[] {
    if (!sorting) {
      return rows
    }

    const { column, descending } = sorting
    const direction = descending ? -1 : 1
    // Missing values stay at the bottom in both directions.
    return rows.toSorted((a, b) => {
      const left = valueAt(a, column)
      const right = valueAt(b, column)
      if (isMissing(left) || isMissing(right)) {
        return Number(isMissing(left)) - Number(isMissing(right))
      }

      return compare(left, right) * direction
    })
  }

  add(entries)

  return {
    get columns() {
      return columns
    },

    get widths() {
      return columns.map((name, column) => widths[column] ?? clampWidth(name.length))
    },

    get rows() {
      sorted ??= sortRows()
      return sorted
    },

    get sorting() {
      return sorting
    },

    apply(change) {
      if (change.removed.length > 0 || change.updated.length > 0) {
        const removed = new Set(change.removed)
        const updated = new Map(change.updated.map((entry) => [entry.key, entry]))
        rows = rows.flatMap((row) => {
          if (removed.has(row.key)) {
            return []
          }

          const entry = updated.get(row.key)
          return entry ? [{ key: row.key, value: entry.value }] : [row]
        })
        if (!explicit) {
          for (const entry of change.updated) {
            infer(entry.value)
          }
        }
      }

      add(change.added)
      sorted = undefined
    },

    setColumns(next) {
      explicit = next
      if (!next) {
        inferred = []
        for (const row of rows) {
          infer(row.value)
        }
      }

      columns = next ?? inferred
      sorting = undefined
      sorted = undefined
      remeasure()
    },

    sort(column) {
      sorted = undefined
      if (sorting?.column !== column) {
        sorting = { column, descending: false }
        return
      }

      sorting = sorting.descending ? undefined : { column, descending: true }
    },

    cell(row, column) {
      return formatCell(valueAt(row, column))
    },
  }
}
