// What the gauge view shows for the latest item, without any DOM, so it's tested on its own.
import type { GaugeSettings } from '@tapet/core'

export type GaugeReading =
  | { kind: 'empty' }
  | { kind: 'error'; message: string }
  // A value that isn't a number, e.g. a status line. Only the number style shows it.
  | { kind: 'text'; text: string }
  | {
      kind: 'number'
      value: number
      text: string
      // Where the value sits between min and max, from 0 to 1.
      fraction: number
      // The color of the highest threshold the value reached.
      color?: string
    }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function formatNumber(value: number): string {
  const options: Intl.NumberFormatOptions =
    Math.abs(value) >= 1 || value === 0
      ? { maximumFractionDigits: 2 }
      : { maximumSignificantDigits: 3 }
  return value.toLocaleString(undefined, options)
}

// The value to show: the item itself, or its gauge.value field when items are objects.
function pick(item: unknown, field: string | undefined): { value: unknown } | { error: string } {
  if (field === undefined) {
    return isRecord(item)
      ? { error: 'items are objects: set gauge.value to the field to show, e.g. { value: "cpu" }' }
      : { value: item }
  }

  if (!isRecord(item)) {
    return { error: `gauge.value names the field "${field}", but the item isn't an object` }
  }

  if (!(field in item)) {
    return { error: `the item has no field "${field}"` }
  }

  return { value: item[field] }
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return value
  }

  if (typeof value !== 'string' || value.trim() === '') {
    return undefined
  }

  const number = Number(value.trim())
  return Number.isFinite(number) ? number : undefined
}

export function readGauge(item: unknown, settings: GaugeSettings = {}): GaugeReading {
  const { style = 'number', min = 0, max, thresholds = [] } = settings
  const picked = pick(item, settings.value)
  if ('error' in picked) {
    return { kind: 'error', message: picked.error }
  }

  const value = toNumber(picked.value)
  if (value === undefined) {
    const text =
      typeof picked.value === 'string' ? picked.value.trim() : JSON.stringify(picked.value)
    if (style !== 'number') {
      return {
        kind: 'error',
        message: `the ${style} style needs a number, but the value is ${text}`,
      }
    }

    return { kind: 'text', text }
  }

  const fraction = max === undefined ? 0 : Math.min(1, Math.max(0, (value - min) / (max - min)))
  const color = thresholds
    .toSorted((a, b) => a.at - b.at)
    .findLast((threshold) => value >= threshold.at)?.color
  const reading = { kind: 'number' as const, value, text: formatNumber(value), fraction }
  return color ? { ...reading, color } : reading
}
