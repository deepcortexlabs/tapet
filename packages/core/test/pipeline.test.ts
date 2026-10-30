import { expect, it } from 'vitest'
import { createDecoder, createStore, type EntryKey } from '../src/index.ts'

const CSV = 'id,status\n1,new\n2,new\n1,done\n3,"needs ""review"""\n2,done\n'

// Deterministic chunk sizes from 1 to 7 bytes, so failures can be reproduced.
function randomChunks(bytes: Uint8Array, seed: number): Uint8Array[] {
  let state = seed
  const chunks: Uint8Array[] = []
  for (let at = 0; at < bytes.length;) {
    state = (state * 1_103_515_245 + 12_345) % 2 ** 31
    const size = 1 + Math.floor((state / 2 ** 31) * 7)
    chunks.push(bytes.slice(at, at + size))
    at += size
  }

  return chunks
}

it.each([1, 2, 3, 42, 1234])(
  'decodes a chunked csv stream into an upsert store (seed %i)',
  (seed) => {
    const decoder = createDecoder('csv')
    const store = createStore({ update: 'upsert', key: 'id', retention: 'all' })
    const added: EntryKey[] = []
    const results = [
      ...randomChunks(new TextEncoder().encode(CSV), seed).map((chunk) => decoder.push(chunk)),
      decoder.end(),
    ]
    for (const result of results) {
      expect(result.error).toBeUndefined()
      const { change } = store.apply(result.items, 0)
      added.push(...change.added.map((entry) => entry.key))
    }

    expect(added).toEqual(['1', '2', '3'])
    expect(store.entries().map((entry) => entry.value)).toEqual([
      { id: '1', status: 'done' },
      { id: '2', status: 'done' },
      { id: '3', status: 'needs "review"' },
    ])
  },
)
