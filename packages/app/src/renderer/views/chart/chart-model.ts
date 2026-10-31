// The uPlot chart's data, without any DOM, so it's tested on its own: x values in ascending order
// and one column of values per series.
import { MAX_SERIES, type ChartSettings, type Entry } from '@tapet/core'

export interface ChartSeries {
  label: string
  values: (number | null)[]
}

export interface ChartData {
  // Milliseconds since 1970 when time is true.
  x: number[]
  time: boolean
  series: ChartSeries[]
}

export type ChartResult =
  | { kind: 'empty' }
  | { kind: 'error'; message: string }
  // warning: a problem with some of the data, shown alongside the chart.
  | { kind: 'data'; data: ChartData; warning?: string }

interface Row {
  x: number
  cells: Map<string, number | null>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function toNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value !== 'string' || value.trim() === '') {
    return null
  }

  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

// Dates are ISO 8601 text or milliseconds since 1970, as in JavaScript and Vega-Lite.
function toX(value: unknown, time: boolean): number | null {
  if (time && typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : parsed
  }

  return toNumber(value)
}

function label(value: unknown): string {
  if (value === undefined || value === null) {
    return '(none)'
  }

  return typeof value === 'string' ? value : JSON.stringify(value)
}

function xProblem(field: string, value: unknown, time: boolean): string {
  if (value === undefined) {
    return `items need the chart.x field "${field}"`
  }

  if (time) {
    return `chart.x values must be dates: ISO 8601 text or milliseconds since 1970`
  }

  return 'chart.x values must be numbers; for dates, set chart.x_type to "time"'
}

export function chartData(entries: Entry[], settings: ChartSettings): ChartResult {
  if (entries.length === 0) {
    return { kind: 'empty' }
  }

  const fields = [settings.y ?? []].flat()
  const time = settings.x === undefined || settings.x_type === 'time'
  // With series, one y field splits into a series per value, in order of first appearance.
  const labels = settings.series === undefined ? [...fields] : []
  const rows: Row[] = []
  let problem: string | undefined

  for (const entry of entries) {
    const item = entry.value
    if (!isRecord(item)) {
      problem ??= 'items must be JSON objects with the chart.y fields'
      continue
    }

    // Without chart.x, each item is placed at the time it arrived.
    const x = settings.x === undefined ? entry.receivedAt : toX(item[settings.x], time)
    if (x === null) {
      problem ??= xProblem(settings.x ?? '', item[settings.x ?? ''], time)
      continue
    }

    if (settings.series === undefined) {
      rows.push({ x, cells: new Map(fields.map((field) => [field, toNumber(item[field])])) })
      continue
    }

    const name = label(item[settings.series])
    if (!labels.includes(name)) {
      labels.push(name)
    }

    rows.push({ x, cells: new Map([[name, toNumber(item[fields[0] ?? ''])]]) })
  }

  if (rows.length === 0) {
    return { kind: 'error', message: problem ?? 'no items to plot' }
  }

  rows.sort((a, b) => a.x - b.x)
  const series = labels.slice(0, MAX_SERIES).map((name) => ({
    label: name,
    values: rows.map((row) => row.cells.get(name) ?? null),
  }))
  if (series.every((column) => column.values.every((value) => value === null))) {
    return { kind: 'error', message: `no item has a number in chart.y (${fields.join(', ')})` }
  }

  const data = { x: rows.map((row) => row.x), time, series }
  if (labels.length > MAX_SERIES) {
    return {
      kind: 'data',
      data,
      warning: `chart.series has more than ${MAX_SERIES} values, and the chart shows the first ${MAX_SERIES}`,
    }
  }

  return problem
    ? { kind: 'data', data, warning: `some items were skipped: ${problem}` }
    : { kind: 'data', data }
}

// The latest value at or before an index: series split by chart.series rarely share x values, so
// the readout at any x shows each series' latest value.
export function valueAt(
  values: ArrayLike<number | null | undefined>,
  index: number,
): number | null {
  for (let at = index; at >= 0; at -= 1) {
    const value = values[at]
    if (value !== null && value !== undefined) {
      return value
    }
  }

  return null
}
