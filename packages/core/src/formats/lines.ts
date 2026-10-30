import type { Decoder } from './decoder.ts'
import { createLineSplitter } from './text.ts'

// Each line is a string item. Empty lines are kept.
export function createLinesDecoder(): Decoder {
  const lines = createLineSplitter()

  return {
    push: (chunk) => ({ items: lines.push(chunk), skipped: 0 }),
    end: () => ({ items: lines.end(), skipped: 0 }),
  }
}
