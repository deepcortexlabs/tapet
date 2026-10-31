import { expect, it } from 'vitest'
import type { Entry } from '@tapet/core'
import { createTableModel, type TableModel } from '../src/renderer/views/table/table-model.ts'

function entries(...values: unknown[]): Entry[] {
  return values.map((value, index) => ({ key: index + 1, seq: index + 1, receivedAt: 0, value }))
}

function cells(model: TableModel) {
  return model.rows.map((row) => model.columns.map((_, column) => model.cell(row, column)))
}

it('takes columns from the fields in order of first appearance', () => {
  const model = createTableModel(entries({ name: 'a', n: 1 }, { n: 2, tags: ['x'] }))
  expect(model.columns).toEqual(['name', 'n', 'tags'])
  expect(cells(model)).toEqual([
    ['a', '1', ''],
    ['', '2', '["x"]'],
  ])
})

it('shows only the columns the agent names', () => {
  const model = createTableModel(entries({ name: 'a', n: 1 }), ['n'])
  expect(cells(model)).toEqual([['1']])
})

it('names the positions of csv rows without a header', () => {
  expect(createTableModel(entries(['a', '1'])).columns).toEqual(['1', '2'])
  expect(cells(createTableModel(entries(['a', '1']), ['name', 'n']))).toEqual([['a', '1']])
})

it('sorts numbers and numeric text by value, then descending, then back to arrival order', () => {
  const model = createTableModel(entries({ n: '10' }, { n: '9' }, { n: '' }, { n: '100' }))
  model.sort(0)
  expect(cells(model).flat()).toEqual(['9', '10', '100', ''])
  model.sort(0)
  expect(cells(model).flat()).toEqual(['100', '10', '9', ''])
  model.sort(0)
  expect(cells(model).flat()).toEqual(['10', '9', '', '100'])
})

it('keeps updated rows in place and new rows in sorted position', () => {
  const model = createTableModel(entries({ id: 'b', n: 2 }, { id: 'a', n: 1 }))
  model.apply({
    added: [],
    updated: [{ key: 1, seq: 3, receivedAt: 0, value: { id: 'b', n: 5 } }],
    removed: [],
  })
  expect(cells(model)).toEqual([
    ['b', '5'],
    ['a', '1'],
  ])
  model.sort(1)
  model.apply({
    added: [{ key: 3, seq: 4, receivedAt: 0, value: { id: 'c', n: 3 } }],
    updated: [],
    removed: [2],
  })
  expect(cells(model)).toEqual([
    ['c', '3'],
    ['b', '5'],
  ])
})

it('sizes columns from the header and the data, within limits', () => {
  const model = createTableModel(entries({ id: 1, message: 'x'.repeat(100) }))
  expect(model.widths).toEqual([4, 40])
})
