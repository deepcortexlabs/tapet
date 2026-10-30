import { describe, expect, it } from 'vitest'
import { createStore, type Change, type Store } from '../src/index.ts'

function values(store: Store) {
  return store.entries().map((entry) => entry.value)
}

function changed(change: Change) {
  return {
    added: change.added.map((entry) => entry.value),
    updated: change.updated.map((entry) => entry.value),
    removed: change.removed,
  }
}

describe('append', () => {
  it('keeps items in arrival order and reports them as added', () => {
    const store = createStore({ update: 'append', retention: 'all' })
    const { change } = store.apply(['a', 'b'], 0)
    expect(changed(change)).toEqual({ added: ['a', 'b'], updated: [], removed: [] })
    expect(store.entries().map((entry) => entry.seq)).toEqual([1, 2])
    expect(values(store)).toEqual(['a', 'b'])
  })
})

describe('replace', () => {
  it('keeps only the latest item', () => {
    const store = createStore({ update: 'replace', retention: 'all' })
    expect(changed(store.apply(['a', 'b'], 0).change)).toEqual({
      added: ['b'],
      updated: [],
      removed: [],
    })
    expect(changed(store.apply(['c'], 0).change)).toEqual({
      added: [],
      updated: ['c'],
      removed: [],
    })
    expect(values(store)).toEqual(['c'])
  })
})

describe('upsert', () => {
  it('replaces items by key in place and removes items marked deleted', () => {
    const store = createStore({ update: 'upsert', key: 'id', retention: 'all' })
    store.apply(
      [
        { id: 1, v: 'a' },
        { id: 2, v: 'b' },
      ],
      0,
    )
    const { change } = store.apply([{ id: 1, v: 'c' }, { id: 2, _deleted: true }, { id: 3 }], 0)
    expect(changed(change)).toEqual({
      added: [{ id: 3 }],
      updated: [{ id: 1, v: 'c' }],
      removed: [2],
    })
    expect(values(store)).toEqual([{ id: 1, v: 'c' }, { id: 3 }])
  })

  it('never stores the _deleted marker', () => {
    const store = createStore({ update: 'upsert', key: 'id', retention: 'all' })
    store.apply([{ id: 1, _deleted: false, v: 1 }], 0)
    expect(values(store)).toEqual([{ id: 1, v: 1 }])
  })

  it('stops at an item without a usable key, keeping the items before it', () => {
    const store = createStore({ update: 'upsert', key: 'id', retention: 'all' })
    const result = store.apply([{ id: 1 }, { name: 'x' }, { id: 2 }], 0)
    expect(result.error).toEqual({ index: 1, message: 'item has no "id" field' })
    expect(values(store)).toEqual([{ id: 1 }])
  })

  it('explains why a key is unusable', () => {
    const store = createStore({ update: 'upsert', key: 'id', retention: 'all' })
    expect(store.apply(['text'], 0).error?.message).toBe('expected an object with a "id" field')
    expect(store.apply([{ id: {} }], 0).error?.message).toBe('"id" must be a string or a number')
  })

  it('skips and counts items without a usable key when told to ignore them', () => {
    const store = createStore({ update: 'upsert', key: 'id', retention: 'all' })
    const result = store.apply([{ id: 1 }, { name: 'x' }, { id: 2 }], 0, { ignoreInvalid: true })
    expect(result.skipped).toBe(1)
    expect(result.error).toBeUndefined()
    expect(values(store)).toEqual([{ id: 1 }, { id: 2 }])
  })
})

describe('patch', () => {
  it('merges fields into the item and drops fields set to null', () => {
    const store = createStore({ update: 'patch', key: 'id', retention: 'all' })
    store.apply([{ id: 1, a: 1, b: 2 }], 0)
    store.apply([{ id: 1, b: null, c: 3 }], 0)
    expect(values(store)).toEqual([{ id: 1, a: 1, c: 3 }])
  })

  it('creates unknown items without their null fields', () => {
    const store = createStore({ update: 'patch', key: 'id', retention: 'all' })
    store.apply([{ id: 1, x: null, y: 1 }], 0)
    expect(values(store)).toEqual([{ id: 1, y: 1 }])
  })

  it('removes items marked deleted', () => {
    const store = createStore({ update: 'patch', key: 'id', retention: 'all' })
    store.apply([{ id: 1, a: 1 }], 0)
    store.apply([{ id: 1, _deleted: true }], 0)
    expect(values(store)).toEqual([])
  })
})

describe('change sets', () => {
  it('report an item added and updated in the same batch once, as added', () => {
    const store = createStore({ update: 'upsert', key: 'id', retention: 'all' })
    const { change } = store.apply(
      [
        { id: 1, v: 1 },
        { id: 1, v: 2 },
      ],
      0,
    )
    expect(changed(change)).toEqual({ added: [{ id: 1, v: 2 }], updated: [], removed: [] })
  })

  it('leave out an item added and deleted in the same batch', () => {
    const store = createStore({ update: 'upsert', key: 'id', retention: 'all' })
    const { change } = store.apply([{ id: 1 }, { id: 1, _deleted: true }], 0)
    expect(changed(change)).toEqual({ added: [], updated: [], removed: [] })
  })

  it('report an item deleted and added again as removed and added, since it moves to the end', () => {
    const store = createStore({ update: 'upsert', key: 'id', retention: 'all' })
    store.apply([{ id: 1 }, { id: 2 }], 0)
    const { change } = store.apply(
      [
        { id: 1, _deleted: true },
        { id: 1, v: 'back' },
      ],
      0,
    )
    expect(changed(change)).toEqual({ added: [{ id: 1, v: 'back' }], updated: [], removed: [1] })
    expect(values(store)).toEqual([{ id: 2 }, { id: 1, v: 'back' }])
  })
})

describe('retention', () => {
  it('keeps the newest items when limited to the last N', () => {
    const store = createStore({ update: 'append', retention: { last: 2 } })
    const { change } = store.apply(['a', 'b', 'c'], 0)
    expect(values(store)).toEqual(['b', 'c'])
    expect(changed(change)).toEqual({ added: ['b', 'c'], updated: [], removed: [] })
  })

  it('evicts the least recently written keyed items', () => {
    const store = createStore({ update: 'upsert', key: 'id', retention: { last: 2 } })
    store.apply([{ id: 1 }, { id: 2 }], 0)
    store.apply([{ id: 1, v: 'fresh' }], 0)
    const { change } = store.apply([{ id: 3 }], 0)
    expect(change.removed).toEqual([2])
    expect(values(store)).toEqual([{ id: 1, v: 'fresh' }, { id: 3 }])
  })

  it('drops items older than the time limit when new items arrive', () => {
    const store = createStore({ update: 'append', retention: { seconds: 3 } })
    store.apply(['old'], 0)
    const { change } = store.apply(['new'], 5_000)
    expect(changed(change)).toEqual({ added: ['new'], updated: [], removed: [1] })
    expect(values(store)).toEqual(['new'])
  })

  it('expires items by time while no input arrives', () => {
    const store = createStore({ update: 'append', retention: { seconds: 3 } })
    store.apply(['a'], 0)
    expect(store.trim(2_000).removed).toEqual([])
    expect(store.trim(3_500).removed).toEqual([1])
    expect(values(store)).toEqual([])
  })

  it('applies a changed retention immediately', () => {
    const store = createStore({ update: 'append', retention: 'all' })
    store.apply(['a', 'b', 'c'], 0)
    expect(store.setRetention({ last: 1 }, 0).removed).toEqual([1, 2])
    expect(values(store)).toEqual(['c'])
  })
})

it('refuses keyed update modes without a key', () => {
  expect(() => createStore({ update: 'upsert', retention: 'all' })).toThrow('upsert needs a key')
})
