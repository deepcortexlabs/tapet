// Decodes a UTF-8 byte stream. Characters split across chunks are handled, invalid bytes become
// U+FFFD, and a leading byte order mark is dropped (TextDecoder's defaults).
export function createTextStream() {
  const decoder = new TextDecoder()

  return {
    push(chunk: Uint8Array): string {
      return decoder.decode(chunk, { stream: true })
    },

    end(): string {
      return decoder.decode()
    },
  }
}

// Splits a UTF-8 byte stream into lines, accepting both LF and CRLF.
export function createLineSplitter() {
  const text = createTextStream()
  let pending = ''

  return {
    push(chunk: Uint8Array): string[] {
      const lines = (pending + text.push(chunk)).split('\n')
      pending = lines.pop() ?? ''
      return lines.map(withoutCarriageReturn)
    },

    // Returns the last line when the stream doesn't end with a newline.
    end(): string[] {
      const rest = pending + text.end()
      pending = ''
      if (rest === '') {
        return []
      }

      return [withoutCarriageReturn(rest)]
    },
  }
}

function withoutCarriageReturn(line: string): string {
  if (!line.endsWith('\r')) {
    return line
  }

  return line.slice(0, -1)
}
