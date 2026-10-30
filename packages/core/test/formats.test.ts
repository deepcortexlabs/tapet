import { describe, expect, it } from 'vitest'
import { createDecoder, type DecoderOptions, type Format } from '../src/index.ts'

const encoder = new TextEncoder()

// Decodes chunks the way a pipe delivers them and merges the results.
function decode(format: Format, chunks: Uint8Array[], options?: DecoderOptions) {
  const decoder = createDecoder(format, options)
  const results = [...chunks.map((chunk) => decoder.push(chunk)), decoder.end()]
  return {
    items: results.flatMap((result) => result.items),
    skipped: results.reduce((sum, result) => sum + result.skipped, 0),
    error: results.find((result) => result.error)?.error,
  }
}

function decodeText(format: Format, text: string, options?: DecoderOptions) {
  return decode(format, [encoder.encode(text)], options)
}

// Checks every way of splitting the input into two chunks, including splits inside
// multi-byte characters, CRLF pairs and quoted CSV fields.
function expectSameAtEverySplit(
  format: Format,
  text: string,
  expectedItems: unknown[],
  options?: DecoderOptions,
) {
  const bytes = encoder.encode(text)
  for (let at = 0; at <= bytes.length; at += 1) {
    const result = decode(format, [bytes.slice(0, at), bytes.slice(at)], options)
    expect(result.items, `split at byte ${at}`).toEqual(expectedItems)
    expect(result.error, `split at byte ${at}`).toBeUndefined()
  }
}

describe('lines', () => {
  it('splits lines at any chunk boundary, with CRLF, a byte order mark and multi-byte characters', () => {
    expectSameAtEverySplit('lines', '\uFEFFשלום\r\nworld 🌍\n\nlast', [
      'שלום',
      'world 🌍',
      '',
      'last',
    ])
  })

  it('turns invalid bytes into replacement characters instead of failing', () => {
    const result = decode('lines', [new Uint8Array([0x61, 0xff, 0x0a])])
    expect(result.items).toEqual(['a\uFFFD'])
    expect(result.error).toBeUndefined()
  })
})

describe('ndjson', () => {
  it('parses one JSON value per line and skips blank lines', () => {
    expectSameAtEverySplit('ndjson', '{"a":1}\n\n  \n[2]\r\n"שלום"', [{ a: 1 }, [2], 'שלום'])
  })

  it('stops at the first malformed line and reports where it is', () => {
    const result = decodeText('ndjson', '{"a":1}\nnot json\n{"b":2}\n')
    expect(result.items).toEqual([{ a: 1 }])
    expect(result.error).toMatchObject({ line: 2, sample: 'not json' })
    expect(result.error?.message).toContain('invalid JSON')
  })

  it('yields nothing more after it stopped', () => {
    const decoder = createDecoder('ndjson')
    decoder.push(encoder.encode('oops\n'))
    expect(decoder.push(encoder.encode('{"a":1}\n')).items).toEqual([])
    expect(decoder.end().items).toEqual([])
  })

  it('skips and counts malformed lines when told to ignore them', () => {
    const result = decodeText('ndjson', '{"a":1}\nnot json\n{"b":2}\n', { ignoreMalformed: true })
    expect(result.items).toEqual([{ a: 1 }, { b: 2 }])
    expect(result.skipped).toBe(1)
    expect(result.error).toBeUndefined()
  })
})

describe('csv', () => {
  it('reads quoted commas, quotes and newlines at any chunk boundary', () => {
    const text = 'name,note\r\nann,"likes ""quotes"", commas"\n\nבוב,"line one\nline two"\n'
    expectSameAtEverySplit('csv', text, [
      { name: 'ann', note: 'likes "quotes", commas' },
      { name: 'בוב', note: 'line one\nline two' },
    ])
  })

  it('keeps values as strings', () => {
    expect(decodeText('csv', 'n,flag\n42,true\n').items).toEqual([{ n: '42', flag: 'true' }])
  })

  it('reads a last record without a trailing newline', () => {
    expect(decodeText('csv', 'x,y\n1,2').items).toEqual([{ x: '1', y: '2' }])
  })

  it('yields arrays when there is no header', () => {
    expect(decodeText('csv', 'a,b\nc\n', { header: false }).items).toEqual([['a', 'b'], ['c']])
  })

  it('stops at a record with the wrong number of columns', () => {
    const result = decodeText('csv', 'x,y\n1,2\n3\n4,5\n')
    expect(result.items).toEqual([{ x: '1', y: '2' }])
    expect(result.error).toMatchObject({ line: 3, message: 'expected 2 columns, got 1' })
  })

  it('skips and counts records with the wrong number of columns when told to ignore them', () => {
    const result = decodeText('csv', 'x,y\n1,2\n3\n4,5\n', { ignoreMalformed: true })
    expect(result.items).toEqual([
      { x: '1', y: '2' },
      { x: '4', y: '5' },
    ])
    expect(result.skipped).toBe(1)
  })

  it('reports a quoted field that never closes', () => {
    const result = decodeText('csv', 'x\n"open')
    expect(result.items).toEqual([])
    expect(result.error).toMatchObject({ line: 2, message: 'unterminated quoted field' })
  })

  it('keeps a column named __proto__ as a plain field', () => {
    const [item] = decodeText('csv', '__proto__,b\n1,2\n').items as Record<string, unknown>[]
    expect(Object.getPrototypeOf(item)).toBe(Object.prototype)
    expect(Object.keys(item ?? {})).toEqual(['__proto__', 'b'])
  })
})

describe('whole', () => {
  it("turns a pipe's entire input into one item of raw bytes", () => {
    const result = decode('whole', [new Uint8Array([1, 2]), new Uint8Array([3])])
    expect(result.items).toEqual([new Uint8Array([1, 2, 3])])
  })

  it('yields an empty item for empty input', () => {
    expect(decode('whole', []).items).toEqual([new Uint8Array()])
  })
})
