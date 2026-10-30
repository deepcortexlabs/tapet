import {
  createCollector,
  sample,
  type DecodeResult,
  type Decoder,
  type DecoderOptions,
} from './decoder.ts'
import { createTextStream } from './text.ts'

type State = 'fieldStart' | 'unquoted' | 'quoted' | 'quoteInQuoted'

// RFC 4180 CSV: quoted fields may hold commas, newlines and "" escapes. With a header, items are
// objects of strings keyed by column name; without one, items are arrays of strings. Values are
// never converted, since views convert them according to their mapping. Empty lines are skipped.
export function createCsvDecoder({
  header = true,
  ignoreMalformed = false,
}: DecoderOptions = {}): Decoder {
  const text = createTextStream()
  const collector = createCollector(ignoreMalformed)
  let columns: string[] | undefined
  let state: State = 'fieldStart'
  let field = ''
  let record: string[] = []
  // Whether the current record has any content yet; a line without content is skipped.
  let started = false
  let line = 1
  let recordLine = 1

  function endField() {
    record.push(field)
    field = ''
  }

  // Returns whether decoding continues.
  function endRecord(result: DecodeResult): boolean {
    const fields = record
    record = []
    started = false
    if (header && !columns) {
      columns = fields
      return true
    }

    if (!columns) {
      result.items.push(fields)
      return true
    }

    if (fields.length !== columns.length) {
      const error = {
        line: recordLine,
        message: `expected ${columns.length} columns, got ${fields.length}`,
        sample: sample(fields.join(',')),
      }
      return collector.malformed(result, error)
    }

    result.items.push(Object.fromEntries(columns.map((name, index) => [name, fields[index] ?? ''])))
    return true
  }

  function endLine(result: DecodeResult): boolean {
    state = 'fieldStart'
    if (!started) {
      return true
    }

    endField()
    return endRecord(result)
  }

  // Advances the parser by one character. Returns whether decoding continues.
  function step(char: string, result: DecodeResult): boolean {
    if (state === 'quoted') {
      if (char === '"') {
        state = 'quoteInQuoted'
        return true
      }

      field += char
      return true
    }

    if (state === 'quoteInQuoted' && char === '"') {
      field += '"'
      state = 'quoted'
      return true
    }

    if (char === '\r') {
      return true
    }

    if (char === ',') {
      endField()
      state = 'fieldStart'
      return true
    }

    if (char === '\n') {
      return endLine(result)
    }

    if (state === 'fieldStart' && char === '"') {
      state = 'quoted'
      return true
    }

    // Lenient about stray quotes: inside an unquoted field, or right after a closing quote, they're literal.
    field += char
    state = 'unquoted'
    return true
  }

  function consume(chunk: string, result: DecodeResult): boolean {
    for (const char of chunk) {
      if (!started && char !== '\r' && char !== '\n') {
        started = true
        recordLine = line
      }

      if (!step(char, result)) {
        return false
      }

      if (char === '\n') {
        line += 1
      }
    }

    return true
  }

  return {
    push(chunk) {
      const result = collector.start()
      if (collector.failed) {
        return result
      }

      consume(text.push(chunk), result)
      return result
    },

    end() {
      const result = collector.start()
      if (collector.failed || !consume(text.end(), result)) {
        return result
      }

      if (state === 'quoted') {
        collector.malformed(result, {
          line: recordLine,
          message: 'unterminated quoted field',
          sample: sample(field),
        })
        return result
      }

      if (started) {
        endField()
        endRecord(result)
      }

      return result
    },
  }
}
