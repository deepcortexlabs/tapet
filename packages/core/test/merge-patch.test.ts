import { describe, expect, it } from 'vitest'
import { mergePatch } from '../src/index.ts'

// The examples from RFC 7396, appendix A: target, patch, result.
const RFC_EXAMPLES: Array<[unknown, unknown, unknown]> = [
  [{ a: 'b' }, { a: 'c' }, { a: 'c' }],
  [{ a: 'b' }, { b: 'c' }, { a: 'b', b: 'c' }],
  [{ a: 'b' }, { a: null }, {}],
  [{ a: 'b', b: 'c' }, { a: null }, { b: 'c' }],
  [{ a: ['b'] }, { a: 'c' }, { a: 'c' }],
  [{ a: 'c' }, { a: ['b'] }, { a: ['b'] }],
  [{ a: { b: 'c' } }, { a: { b: 'd', c: null } }, { a: { b: 'd' } }],
  [{ a: [{ b: 'c' }] }, { a: [1] }, { a: [1] }],
  [
    ['a', 'b'],
    ['c', 'd'],
    ['c', 'd'],
  ],
  [{ a: 'b' }, ['c'], ['c']],
  [{ a: 'foo' }, null, null],
  [{ a: 'foo' }, 'bar', 'bar'],
  [{ e: null }, { a: 1 }, { e: null, a: 1 }],
  [[1, 2], { a: 'b', c: null }, { a: 'b' }],
  [{}, { a: { bb: { ccc: null } } }, { a: { bb: {} } }],
]

describe('mergePatch', () => {
  it.each(RFC_EXAMPLES)('patches %j with %j', (target, patch, result) => {
    expect(mergePatch(target, patch)).toEqual(result)
  })

  it('leaves the target unchanged', () => {
    const target = { a: { b: 1 } }
    mergePatch(target, { a: { b: 2, c: 3 } })
    expect(target).toEqual({ a: { b: 1 } })
  })

  it('keeps a field named __proto__ as a plain field', () => {
    const result = mergePatch({}, JSON.parse('{"__proto__":{"polluted":true}}')) as object
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
    expect(Object.keys(result)).toEqual(['__proto__'])
  })
})
