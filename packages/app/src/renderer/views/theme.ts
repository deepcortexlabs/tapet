// Colors and fonts for charts and graphs come from the theme's CSS variables, so agent CSS can
// change them.
import { MAX_SERIES } from '@tapet/core'

export interface ChartTheme {
  dark: boolean
  // One color per series, in a fixed order (--tapet-series-1 to 8).
  series: string[]
  fg: string
  muted: string
  grid: string
  axis: string
  surface: string
  font: string
}

// Sequential blue for magnitudes (heatmaps, choropleths), light to dark.
export const SEQUENTIAL = [
  '#cde2fb',
  '#b7d3f6',
  '#9ec5f4',
  '#86b6ef',
  '#6da7ec',
  '#5598e7',
  '#3987e5',
  '#2a78d6',
  '#256abf',
  '#1c5cab',
  '#184f95',
  '#104281',
  '#0d366b',
]

const DARK = '(prefers-color-scheme: dark)'

export function readTheme(element: HTMLElement): ChartTheme {
  const style = getComputedStyle(element)
  const value = (name: string) => style.getPropertyValue(name).trim()
  return {
    dark: matchMedia(DARK).matches,
    series: Array.from({ length: MAX_SERIES }, (_, index) => value(`--tapet-series-${index + 1}`)),
    fg: value('--tapet-fg'),
    muted: value('--tapet-muted'),
    grid: value('--tapet-grid'),
    axis: value('--tapet-axis'),
    surface: value('--tapet-panel-bg'),
    font: value('--tapet-font'),
  }
}

export function onThemeChange(callback: () => void): () => void {
  const query = matchMedia(DARK)
  query.addEventListener('change', callback)
  return () => query.removeEventListener('change', callback)
}

const canvas = document.createElement('canvas').getContext('2d')

// Any CSS color as red, green, blue and alpha from 0 to 1. A canvas reads the color, so names,
// rgb() and hsl() all work; the canvas writes it back as #rrggbb, or as rgba() when transparent.
export function toRgba(color: string): [number, number, number, number] {
  if (!canvas) {
    return [0, 0, 0, 1]
  }

  canvas.fillStyle = '#000000'
  canvas.fillStyle = color
  const normalized = String(canvas.fillStyle)
  if (normalized.startsWith('#')) {
    const rgb = Number.parseInt(normalized.slice(1), 16)
    return [(rgb >> 16) / 255, ((rgb >> 8) & 255) / 255, (rgb & 255) / 255, 1]
  }

  const [red = 0, green = 0, blue = 0, alpha = 1] = (normalized.match(/[\d.]+/g) ?? []).map(Number)
  return [red / 255, green / 255, blue / 255, alpha]
}

// Any CSS color with transparency, e.g. for an area's wash.
export function withAlpha(color: string, alpha: number): string {
  const [red, green, blue] = toRgba(color).map((channel) => Math.round(channel * 255))
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}
