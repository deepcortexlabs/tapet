import type { Format } from '../settings.ts'
import { createCsvDecoder } from './csv.ts'
import type { Decoder, DecoderOptions } from './decoder.ts'
import { createLinesDecoder } from './lines.ts'
import { createNdjsonDecoder } from './ndjson.ts'
import { createWholeDecoder } from './whole.ts'

export type { DecodeResult, Decoder, DecoderOptions, MalformedError } from './decoder.ts'

// One decoder per pipe: each pipe is split into items on its own.
export function createDecoder(format: Format, options: DecoderOptions = {}): Decoder {
  switch (format) {
    case 'lines':
      return createLinesDecoder()
    case 'ndjson':
      return createNdjsonDecoder(options)
    case 'csv':
      return createCsvDecoder(options)
    case 'whole':
      return createWholeDecoder()
  }
}
