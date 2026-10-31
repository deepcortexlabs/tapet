// uPlot options for time series: the theme's series colors, 2px lines, recessive axes, a
// crosshair tooltip listing every series, and labels at the ends of a few lines.
import type { ChartSettings } from '@tapet/core'
import uPlot from 'uplot'
import { valueAt, type ChartData } from './chart-model.ts'
import { withAlpha, type ChartTheme } from '../theme.ts'

type ChartType = NonNullable<ChartSettings['type']>

// Lines get labels at their ends when there are this few of them; more would collide.
const END_LABELS = 4
const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })
const plain = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })

// Axis ticks: compact from 1,000 up (1K, 2.5M).
export function formatTick(value: number): string {
  return Math.abs(value) >= 1000 ? compact.format(value) : plain.format(value)
}

function formatX(value: number, time: boolean): string {
  return time ? new Date(value).toLocaleString() : plain.format(value)
}

function labelWidth(labels: string[], font: string): number {
  const context = document.createElement('canvas').getContext('2d')
  if (!context) {
    return 0
  }

  context.font = `12px ${font}`
  return Math.max(...labels.map((label) => context.measureText(label).width))
}

function seriesOptions(label: string, color: string, type: ChartType, theme: ChartTheme) {
  // Markers are 8px dots in the series color, ringed by the surface so they stay legible.
  const points = { size: 10, width: 2, stroke: theme.surface, fill: color }
  const line: uPlot.Series = {
    label,
    stroke: color,
    width: 2,
    cap: 'round',
    spanGaps: true,
    points,
  }
  if (type === 'bar') {
    return {
      label,
      fill: color,
      paths: uPlot.paths.bars?.({ size: [0.6, 24], radius: [0.17, 0], gap: 2 }),
      points: { show: false },
    } satisfies uPlot.Series
  }

  if (type === 'points') {
    return { ...line, paths: () => null, points: { ...points, show: true } } satisfies uPlot.Series
  }

  return type === 'area' ? { ...line, fill: withAlpha(color, 0.1) } : line
}

function axisOptions(theme: ChartTheme, baseline: boolean): uPlot.Axis {
  return {
    stroke: theme.muted,
    font: `11px ${theme.font}`,
    grid: { stroke: theme.grid, width: 1 },
    ticks: { show: baseline, stroke: theme.axis, width: 1, size: 4 },
    border: { show: baseline, stroke: theme.axis, width: 1 },
  }
}

// One readout for every series at the crosshair: the value leads, the series name follows.
function tooltip(time: boolean, theme: ChartTheme): uPlot.Plugin {
  const box = document.createElement('div')
  box.className = 'tapet-chart-tooltip'
  box.hidden = true

  function update(u: uPlot) {
    const { idx, left = -1, top = 0 } = u.cursor
    if (idx === null || idx === undefined || left < 0) {
      box.hidden = true
      return
    }

    const heading = document.createElement('div')
    heading.className = 'tapet-chart-tooltip-x'
    heading.textContent = formatX(u.data[0][idx] ?? 0, time)
    const rows = u.series.slice(1).map((series, index) => {
      const row = document.createElement('div')
      row.className = 'tapet-chart-tooltip-row'
      const key = document.createElement('span')
      key.className = 'tapet-chart-key'
      key.style.background = theme.series[index] ?? theme.muted
      const value = document.createElement('strong')
      const found = valueAt(u.data[index + 1] ?? [], idx)
      value.textContent = found === null ? '–' : plain.format(found)
      const name = document.createElement('span')
      name.textContent = String(series.label ?? '')
      row.append(key, value, name)
      return row
    })
    box.replaceChildren(heading, ...rows)
    box.hidden = false
    const right = left + 12 + box.offsetWidth > u.over.clientWidth
    const x = right ? left - 12 - box.offsetWidth : left + 12
    const y = Math.max(
      0,
      Math.min(top - box.offsetHeight / 2, u.over.clientHeight - box.offsetHeight),
    )
    box.style.transform = `translate(${x}px, ${y}px)`
  }

  return {
    hooks: {
      init: (u) => {
        u.over.append(box)
      },
      setCursor: update,
    },
  }
}

// An end dot and the series name beside each line's latest visible point. A label that would
// overlap another is left out; the legend still names the series.
function drawEndLabels(u: uPlot, theme: ChartTheme) {
  const ratio = devicePixelRatio
  const { ctx } = u
  const ends = u.series.slice(1).flatMap((series, index) => {
    const values = u.data[index + 1] ?? []
    const last = series.idxs?.[1] ?? values.length - 1
    for (let at = last; at >= (series.idxs?.[0] ?? 0); at -= 1) {
      const value = values[at]
      if (value !== null && value !== undefined) {
        const x = u.valToPos(u.data[0][at] ?? 0, 'x', true)
        const y = u.valToPos(value, 'y', true)
        return [
          { x, y, color: theme.series[index] ?? theme.muted, label: String(series.label ?? '') },
        ]
      }
    }

    return []
  })

  ctx.save()
  ctx.font = `${12 * ratio}px ${theme.font}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  const placed: number[] = []
  for (const end of ends.toSorted((a, b) => a.y - b.y)) {
    ctx.beginPath()
    ctx.arc(end.x, end.y, 4 * ratio, 0, 2 * Math.PI)
    ctx.fillStyle = end.color
    ctx.fill()
    ctx.lineWidth = 2 * ratio
    ctx.strokeStyle = theme.surface
    ctx.stroke()
    if (placed.some((y) => Math.abs(y - end.y) < 14 * ratio)) {
      continue
    }

    placed.push(end.y)
    ctx.fillStyle = theme.fg
    ctx.fillText(end.label, u.bbox.left + u.bbox.width + 10 * ratio, end.y)
  }

  ctx.restore()
}

export interface PlotEvents {
  // The user dragged to zoom in.
  zoom(): void
}

export function plotOptions(
  data: ChartData,
  settings: ChartSettings,
  theme: ChartTheme,
  size: { width: number; height: number },
  events: PlotEvents,
): uPlot.Options {
  const type = settings.type ?? 'line'
  const count = data.series.length
  // A single series needs no legend: the panel's title names it.
  const legend = count >= 2
  const labeled = legend && count <= END_LABELS && type !== 'points'
  const labels = data.series.map((series) => series.label)
  return {
    ...size,
    ms: 1,
    padding: [12, labeled ? labelWidth(labels, theme.font) + 24 : 16, 0, 0],
    scales: {
      x: { time: data.time },
      // Bars and areas show magnitude, so they grow from zero.
      ...(type === 'bar' || type === 'area'
        ? {
            y: {
              range: (_, min, max) => uPlot.rangeNum(Math.min(0, min), Math.max(0, max), 0.1, true),
            },
          }
        : {}),
    },
    legend: {
      show: legend,
      live: false,
      markers: { width: 0, fill: (_, index) => theme.series[index - 1] ?? theme.muted },
    },
    cursor: {
      y: false,
      drag: { x: true, y: false },
      points: {
        size: 10,
        width: 2,
        stroke: theme.surface,
        fill: (_, index) => theme.series[index - 1] ?? theme.muted,
      },
    },
    series: [
      { label: settings.x ?? 'time' },
      ...labels.map((label, index) =>
        seriesOptions(label, theme.series[index] ?? theme.muted, type, theme),
      ),
    ],
    axes: [
      axisOptions(theme, true),
      { ...axisOptions(theme, false), values: (_, splits) => splits.map(formatTick) },
    ],
    hooks: {
      setSelect: [
        (u) => {
          if (u.select.width > 0) {
            events.zoom()
          }
        },
      ],
      draw: labeled ? [(u) => drawEndLabels(u, theme)] : [],
    },
    plugins: [tooltip(data.time, theme)],
  }
}
