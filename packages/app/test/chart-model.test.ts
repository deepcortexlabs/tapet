import { expect, it } from 'vitest'
import type { Entry } from '@tapet/core'
import { chartData, valueAt } from '../src/renderer/views/chart/chart-model.ts'

function entries(...values: unknown[]): Entry[] {
  return values.map((value, index) => ({
    key: index + 1,
    seq: index + 1,
    receivedAt: 1_000 * (index + 1),
    value,
  }))
}

it('places items at their arrival time when there is no x field', () => {
  expect(chartData(entries({ ms: 5 }, { ms: '7' }), { y: 'ms' })).toEqual({
    kind: 'data',
    data: { x: [1_000, 2_000], time: true, series: [{ label: 'ms', values: [5, 7] }] },
  })
})

it('plots several y fields against a numeric x, sorted by x', () => {
  const result = chartData(entries({ i: 2, a: 1, b: 2 }, { i: 1, a: 3 }), { x: 'i', y: ['a', 'b'] })
  expect(result).toEqual({
    kind: 'data',
    data: {
      x: [1, 2],
      time: false,
      series: [
        { label: 'a', values: [3, 1] },
        { label: 'b', values: [null, 2] },
      ],
    },
  })
})

it('reads dates as ISO 8601 text or milliseconds since 1970', () => {
  const result = chartData(
    entries({ t: '2026-10-31T00:00:00Z', v: 1 }, { t: 1_793_404_800_001, v: 2 }),
    { x: 't', x_type: 'time', y: 'v' },
  )
  expect(result.kind === 'data' && result.data.x).toEqual([1_793_404_800_000, 1_793_404_800_001])
})

it('splits one y field into a series per value of chart.series', () => {
  const result = chartData(
    entries({ host: 'a', cpu: 1 }, { host: 'b', cpu: 2 }, { host: 'a', cpu: 3 }),
    { y: 'cpu', series: 'host' },
  )
  expect(result.kind === 'data' && result.data.series).toEqual([
    { label: 'a', values: [1, null, 3] },
    { label: 'b', values: [null, 2, null] },
  ])
})

it('shows the first 8 series and says so', () => {
  const hosts = Array.from({ length: 10 }, (_, index) => ({ host: `h${index}`, cpu: index }))
  const result = chartData(entries(...hosts), { y: 'cpu', series: 'host' })
  expect(result.kind === 'data' && result.data.series).toHaveLength(8)
  expect(result).toMatchObject({ warning: expect.stringContaining('more than 8 values') })
})

it('explains data it cannot plot', () => {
  expect(chartData(entries({ t: 'monday', v: 1 }), { x: 't', y: 'v' })).toEqual({
    kind: 'error',
    message: 'chart.x values must be numbers; for dates, set chart.x_type to "time"',
  })
  expect(chartData(entries({ v: 1 }), { x: 't', y: 'v' })).toMatchObject({
    message: 'items need the chart.x field "t"',
  })
  expect(chartData(entries({ v: 'n/a' }), { y: 'v' })).toMatchObject({
    message: 'no item has a number in chart.y (v)',
  })
  expect(chartData(entries({ v: 1 }, { w: 2 }, 'text'), { y: 'v' })).toMatchObject({
    kind: 'data',
    warning: expect.stringContaining('some items were skipped'),
  })
})

it("reads a series' latest value at or before an index", () => {
  expect(valueAt([1, null, null], 2)).toBe(1)
  expect(valueAt([null, 2], 0)).toBeNull()
})
