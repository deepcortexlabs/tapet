// Chart colors and fonts come from the theme's CSS variables, so agent CSS can change them.
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

// Any CSS color with transparency, e.g. for an area's wash. A canvas reads the color, so names,
// rgb() and hsl() all work.
export function withAlpha(color: string, alpha: number): string {
  if (!canvas) {
    return color
  }

  canvas.fillStyle = '#000000'
  canvas.fillStyle = color
  const normalized = String(canvas.fillStyle)
  if (!normalized.startsWith('#')) {
    return normalized
  }

  const rgb = Number.parseInt(normalized.slice(1), 16)
  return `rgba(${rgb >> 16}, ${(rgb >> 8) & 255}, ${rgb & 255}, ${alpha})`
}
