import { expect, it } from 'vitest'
import type { Entry } from '@tapet/core'
import { createLogModel } from '../src/renderer/views/log/log-model.ts'

function entries(...texts: string[]): Entry[] {
  return texts.map((value, index) => ({ key: index + 1, seq: index + 1, receivedAt: 0, value }))
}

function texts(model: ReturnType<typeof createLogModel>) {
  return model.lines.map((line) => line.text)
}

it('appends new lines and drops removed ones', () => {
  const model = createLogModel(entries('a', 'b'))
  model.apply({ added: [{ key: 3, seq: 3, receivedAt: 0, value: 'c' }], updated: [], removed: [1] })
  expect(texts(model)).toEqual(['b', 'c'])
  expect(model.total).toBe(2)
})

it('searches case-insensitively, ignoring terminal color codes', () => {
  const model = createLogModel(entries('\u001b[31mERROR\u001b[0m disk full', 'all good'))
  model.search('error')
  expect(texts(model)).toEqual(['\u001b[31mERROR\u001b[0m disk full'])
  expect(model.total).toBe(2)
})

it('keeps the search applied as lines arrive and leave', () => {
  const model = createLogModel(entries('error one', 'fine'))
  model.search('error')
  model.apply({
    added: [{ key: 3, seq: 3, receivedAt: 0, value: 'error two' }],
    updated: [],
    removed: [],
  })
  expect(texts(model)).toEqual(['error one', 'error two'])

  model.apply({ added: [], updated: [], removed: [1] })
  expect(texts(model)).toEqual(['error two'])
})
