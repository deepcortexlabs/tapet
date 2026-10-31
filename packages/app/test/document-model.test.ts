import { expect, it } from 'vitest'
import { imageType, toBytes, toText } from '../src/renderer/views/document/document-model.ts'

const encode = (text: string) => new TextEncoder().encode(text)

it('decodes documents as UTF-8 without the byte order mark', () => {
  expect(toText(encode('\uFEFFשלום, world'))).toBe('שלום, world')
})

it('gives SVG images their type and leaves the rest to the browser', () => {
  expect(imageType(encode('  <svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('image/svg+xml')
  expect(imageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe('')
})

it('treats values that are not bytes as text', () => {
  expect(toText(toBytes('# hi'))).toBe('# hi')
  expect(toText(toBytes({ a: 1 }))).toBe('{"a":1}')
})
