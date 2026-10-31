import { expect, it } from 'vitest'
import { readGauge } from '../src/renderer/views/gauge/gauge-model.ts'

it('reads a line or a bare number as the value', () => {
  expect(readGauge('42.5\n')).toMatchObject({ kind: 'number', value: 42.5, text: '42.5' })
  expect(readGauge(7)).toMatchObject({ kind: 'number', value: 7 })
})

it('reads the gauge.value field of objects', () => {
  expect(readGauge({ cpu: '93' }, { value: 'cpu' })).toMatchObject({ value: 93 })
  expect(readGauge({ cpu: 1 })).toMatchObject({
    kind: 'error',
    message: expect.stringContaining('set gauge.value'),
  })
  expect(readGauge({ mem: 1 }, { value: 'cpu' })).toEqual({
    kind: 'error',
    message: 'the item has no field "cpu"',
  })
})

it('places the value between min and max, clamped', () => {
  expect(readGauge(75, { style: 'dial', min: 50, max: 150 })).toMatchObject({ fraction: 0.25 })
  expect(readGauge(500, { style: 'bar', max: 100 })).toMatchObject({ fraction: 1 })
})

it('colors the value by the highest threshold it reached', () => {
  const thresholds = [
    { at: 90, color: 'red' },
    { at: 70, color: 'orange' },
  ]
  expect(readGauge(80, { thresholds })).toMatchObject({ color: 'orange' })
  expect(readGauge(95, { thresholds })).toMatchObject({ color: 'red' })
  expect(readGauge(10, { thresholds })).not.toHaveProperty('color')
})

it('shows text as is in the number style, which only it can do', () => {
  expect(readGauge('healthy')).toEqual({ kind: 'text', text: 'healthy' })
  expect(readGauge('healthy', { style: 'dial', max: 1 })).toMatchObject({ kind: 'error' })
})
