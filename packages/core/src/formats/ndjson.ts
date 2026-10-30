import {
  createCollector,
  sample,
  type DecodeResult,
  type Decoder,
  type DecoderOptions,
} from './decoder.ts'
import { createLineSplitter } from './text.ts'

// Each non-blank line is one JSON value.
export function createNdjsonDecoder({ ignoreMalformed = false }: DecoderOptions = {}): Decoder {
  const lines = createLineSplitter()
  const collector = createCollector(ignoreMalformed)
  let lineNumber = 0

  function decode(batch: string[]): DecodeResult {
    const result = collector.start()
    if (collector.failed) {
      return result
    }

    for (const line of batch) {
      lineNumber += 1
      if (line.trim() === '') {
        continue
      }

      const parsed = parseJson(line)
      if ('value' in parsed) {
        result.items.push(parsed.value)
        continue
      }

      const error = { line: lineNumber, message: parsed.message, sample: sample(line) }
      if (!collector.malformed(result, error)) {
        return result
      }
    }

    return result
  }

  return {
    push: (chunk) => decode(lines.push(chunk)),
    end: () => decode(lines.end()),
  }
}

function parseJson(text: string): { value: unknown } | { message: string } {
  try {
    return { value: JSON.parse(text) }
  } catch (error) {
    return { message: `invalid JSON: ${error instanceof Error ? error.message : String(error)}` }
  }
}
