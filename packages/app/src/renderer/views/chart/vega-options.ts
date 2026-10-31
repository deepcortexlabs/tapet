// Vega-Lite specs get tapet's theme as their base config; the spec's own config wins.
import { mergePatch } from '@tapet/core'
import type { ChartTheme } from '../theme.ts'

// Sequential blue, light to dark. On a dark surface the ramp runs the other way, so values near
// zero still recede toward the surface.
const BLUES = [
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

// Composite specs size themselves; single views fill the panel.
const COMPOSITE = ['hconcat', 'vconcat', 'concat', 'facet', 'repeat']

function themeConfig(theme: ChartTheme): Record<string, unknown> {
  const text = {
    labelColor: theme.muted,
    titleColor: theme.muted,
    labelFont: theme.font,
    titleFont: theme.font,
    labelFontSize: 11,
    titleFontSize: 11,
    titleFontWeight: 500,
  }
  const ramp = theme.dark ? BLUES.toReversed() : BLUES
  return {
    background: 'transparent',
    font: theme.font,
    view: { stroke: null },
    axis: {
      ...text,
      gridColor: theme.grid,
      domainColor: theme.axis,
      tickColor: theme.axis,
      tickSize: 4,
    },
    axisY: { domain: false, ticks: false },
    legend: { ...text, labelColor: theme.fg },
    title: { color: theme.fg, font: theme.font, fontSize: 13, fontWeight: 600 },
    range: { category: theme.series, ramp, heatmap: ramp },
    line: { strokeWidth: 2, strokeCap: 'round', strokeJoin: 'round' },
    point: { size: 64, filled: true, stroke: theme.surface, strokeWidth: 2 },
    bar: { cornerRadiusEnd: 4 },
    area: { fillOpacity: 0.1, line: true },
  }
}

// Whether the spec fills the panel, so it follows the panel's size.
export function fillsPanel(spec: Record<string, unknown>): boolean {
  return (
    !COMPOSITE.some((key) => key in spec) && spec.width === undefined && spec.height === undefined
  )
}

export function themedSpec(
  spec: Record<string, unknown>,
  theme: ChartTheme,
): Record<string, unknown> {
  const sized = fillsPanel(spec)
    ? {
        width: 'container',
        height: 'container',
        autosize: { type: 'fit', contains: 'padding' },
        ...spec,
      }
    : spec
  return { ...sized, config: mergePatch(themeConfig(theme), spec.config ?? {}) }
}

// Vega-Lite data values are objects; other items arrive as { data: <item> }, as Vega-Lite does
// with arrays of plain values. Copies keep Vega's bookkeeping off the panel's own data.
export function toDatum(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? { ...value }
    : { data: value }
}
