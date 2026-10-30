import { mergePatch } from './merge-patch.ts'
import { isPlainObject } from './object.ts'
import type { Retention, UpdateMode } from './settings.ts'

export type EntryKey = string | number

export interface Entry {
  key: EntryKey
  // Per-panel counter of writes; the entry's last write.
  seq: number
  receivedAt: number
  value: unknown
}

// What an operation changed, as the difference between before and after it. Views apply removed,
// then updated (in place), then added (appended in this order).
export interface Change {
  added: Entry[]
  updated: Entry[]
  removed: EntryKey[]
}

export interface InvalidItem {
  index: number
  message: string
}

export interface ApplyResult {
  change: Change
  skipped: number
  error?: InvalidItem
}

export interface StoreOptions {
  update: UpdateMode
  key?: string
  retention: Retention
}

export interface Store {
  // Applies decoded items. An invalid item stops the batch (items before it stay applied) unless
  // ignoreInvalid is set, in which case it's skipped and counted.
  apply(items: unknown[], receivedAt: number, options?: { ignoreInvalid?: boolean }): ApplyResult
  // Expires data by time-based retention while no input arrives.
  trim(now: number): Change
  setRetention(retention: Retention, now: number): Change
  // In display order: insertion order, with updates kept in place.
  entries(): Entry[]
}

const REPLACE_KEY = 0
const DELETED = '_deleted'

export function createStore(options: StoreOptions): Store {
  const { update, key: keyField } = options
  if ((update === 'upsert' || update === 'patch') && !keyField) {
    throw new Error(`${update} needs a key`)
  }

  let retention = options.retention
  let seq = 0
  const display = new Map<EntryKey, Entry>()
  // Write order, oldest first. Retention evicts from the front.
  const recency = new Map<EntryKey, Entry>()

  // Bookkeeping for the current operation's change set: each touched key's entry before the
  // operation, and the keys (re)inserted during it, in their final insertion order.
  let before = new Map<EntryKey, Entry | undefined>()
  let inserted = new Map<EntryKey, true>()

  function begin() {
    before = new Map()
    inserted = new Map()
  }

  function touch(key: EntryKey) {
    if (before.has(key)) {
      return
    }

    before.set(key, display.get(key))
  }

  function write(key: EntryKey, value: unknown, receivedAt: number) {
    touch(key)
    seq += 1
    const entry = { key, seq, receivedAt, value }
    if (!display.has(key)) {
      inserted.delete(key)
      inserted.set(key, true)
    }

    display.set(key, entry)
    recency.delete(key)
    recency.set(key, entry)
  }

  function remove(key: EntryKey) {
    touch(key)
    display.delete(key)
    recency.delete(key)
  }

  function evict(now: number) {
    if (retention === 'all') {
      return
    }

    if ('last' in retention) {
      for (const key of recency.keys()) {
        if (recency.size <= retention.last) {
          return
        }

        remove(key)
      }

      return
    }

    const cutoff = now - retention.seconds * 1000
    for (const [key, entry] of recency) {
      if (entry.receivedAt >= cutoff) {
        return
      }

      remove(key)
    }
  }

  function finish(): Change {
    const change: Change = { added: [], updated: [], removed: [] }
    for (const [key, previous] of before) {
      const current = display.get(key)
      if (previous && (!current || inserted.has(key))) {
        change.removed.push(key)
      }

      if (previous && current && !inserted.has(key)) {
        change.updated.push(current)
      }
    }

    for (const key of inserted.keys()) {
      const current = display.get(key)
      if (current) {
        change.added.push(current)
      }
    }

    return change
  }

  // Returns why the item is invalid, or nothing when it was applied.
  function applyItem(item: unknown, receivedAt: number): string | undefined {
    if (update === 'append') {
      write(seq + 1, item, receivedAt)
      return
    }

    if (update === 'replace') {
      write(REPLACE_KEY, item, receivedAt)
      return
    }

    if (!isPlainObject(item)) {
      return `expected an object with a "${keyField}" field`
    }

    const key = item[keyField as string]
    if (key === undefined) {
      return `item has no "${keyField}" field`
    }

    if (typeof key !== 'string' && !(typeof key === 'number' && Number.isFinite(key))) {
      return `"${keyField}" must be a string or a number`
    }

    if (item[DELETED] === true) {
      remove(key)
      return
    }

    const value = Object.fromEntries(Object.entries(item).filter(([name]) => name !== DELETED))
    if (update === 'upsert') {
      write(key, value, receivedAt)
      return
    }

    write(key, mergePatch(display.get(key)?.value, value), receivedAt)
  }

  return {
    apply(items, receivedAt, { ignoreInvalid = false } = {}) {
      begin()
      let skipped = 0
      let error: InvalidItem | undefined
      for (const [index, item] of items.entries()) {
        const problem = applyItem(item, receivedAt)
        if (problem === undefined) {
          continue
        }

        if (ignoreInvalid) {
          skipped += 1
          continue
        }

        error = { index, message: problem }
        break
      }

      evict(receivedAt)
      const change = finish()
      if (error) {
        return { change, skipped, error }
      }

      return { change, skipped }
    },

    trim(now) {
      begin()
      evict(now)
      return finish()
    },

    setRetention(next, now) {
      retention = next
      begin()
      evict(now)
      return finish()
    },

    entries() {
      return [...display.values()]
    },
  }
}
