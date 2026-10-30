export interface MalformedError {
  // Line where the bad item starts, counted per pipe from 1.
  line: number
  message: string
  sample: string
}

export interface DecodeResult {
  items: unknown[]
  skipped: number
  error?: MalformedError
}

// Splits one pipe's bytes into items. After a malformed item stops decoding, push() and end()
// return nothing; the caller closes the pipe.
export interface Decoder {
  push(chunk: Uint8Array): DecodeResult
  end(): DecodeResult
}

export interface DecoderOptions {
  // csv only: whether the first line holds the column names. Defaults to true.
  header?: boolean
  // Skip malformed items and count them instead of stopping.
  ignoreMalformed?: boolean
}

// Applies the malformed-data policy: stop at the first bad item, or skip it and count it.
export function createCollector(ignoreMalformed: boolean) {
  let failed = false

  return {
    get failed() {
      return failed
    },

    start(): DecodeResult {
      return { items: [], skipped: 0 }
    },

    // Returns whether decoding continues.
    malformed(result: DecodeResult, error: MalformedError): boolean {
      if (ignoreMalformed) {
        result.skipped += 1
        return true
      }

      failed = true
      result.error = error
      return false
    },
  }
}

// Shortens text for error messages.
export function sample(text: string, max = 80): string {
  if (text.length <= max) {
    return text
  }

  return `${text.slice(0, max)}…`
}
