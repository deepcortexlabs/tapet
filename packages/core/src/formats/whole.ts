import type { Decoder } from './decoder.ts'

// A pipe's entire input is one item: the raw bytes, even when the input is empty.
export function createWholeDecoder(): Decoder {
  const chunks: Uint8Array[] = []
  let size = 0

  return {
    push(chunk) {
      chunks.push(chunk.slice())
      size += chunk.byteLength
      return { items: [], skipped: 0 }
    },

    end() {
      const item = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) {
        item.set(chunk, offset)
        offset += chunk.byteLength
      }

      return { items: [item], skipped: 0 }
    },
  }
}
