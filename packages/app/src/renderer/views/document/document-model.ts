// Turns the document view's items into what it shows, without any DOM, so it's tested on its own.
import type { DocumentSettings } from '@tapet/core'

export type DocumentContent = NonNullable<DocumentSettings['content']>

const decoder = new TextDecoder()
const encoder = new TextEncoder()

// Items of format whole are bytes. Anything else, e.g. from a custom format later, is shown as text.
export function toBytes(value: unknown): Uint8Array<ArrayBuffer> {
  if (value instanceof Uint8Array) {
    return new Uint8Array(value)
  }

  return encoder.encode(typeof value === 'string' ? value : JSON.stringify(value))
}

// UTF-8, without a byte order mark. Invalid bytes become U+FFFD.
export function toText(bytes: Uint8Array): string {
  return decoder.decode(bytes)
}

// The browser sniffs most image types from their bytes, but SVG is text, so it needs its type.
export function imageType(bytes: Uint8Array): string {
  const start = toText(bytes.subarray(0, 256)).trimStart()
  return start.startsWith('<') ? 'image/svg+xml' : ''
}
