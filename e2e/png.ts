// Counts the pixels of a PNG that match a color, to check what a panel drew from its
// window_screenshot image. Reads what Electron writes: 8-bit RGB or RGBA, not interlaced.
import { inflateSync } from 'node:zlib'

// The PNG filters, which predict each byte from its left, upper and upper-left neighbors.
function predict(filter: number, left: number, up: number, upLeft: number): number {
  if (filter === 1) {
    return left
  }

  if (filter === 2) {
    return up
  }

  if (filter === 3) {
    return (left + up) >> 1
  }

  if (filter === 4) {
    const estimate = left + up - upLeft
    const toLeft = Math.abs(estimate - left)
    const toUp = Math.abs(estimate - up)
    const toUpLeft = Math.abs(estimate - upLeft)
    if (toLeft <= toUp && toLeft <= toUpLeft) {
      return left
    }

    return toUp <= toUpLeft ? up : upLeft
  }

  return 0
}

export function countPixels(
  png: Buffer,
  matches: (red: number, green: number, blue: number) => boolean,
): number {
  let width = 0
  let height = 0
  let channels = 0
  const chunks: Buffer[] = []
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset)
    const type = png.toString('latin1', offset + 4, offset + 8)
    const body = png.subarray(offset + 8, offset + 8 + length)
    offset += 12 + length
    if (type === 'IDAT') {
      chunks.push(body)
      continue
    }

    if (type !== 'IHDR') {
      continue
    }

    width = body.readUInt32BE(0)
    height = body.readUInt32BE(4)
    const [depth, color, , , interlace] = body.subarray(8)
    if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) {
      throw new Error(
        `unsupported PNG: depth ${depth}, color type ${color}, interlace ${interlace}`,
      )
    }

    channels = color === 6 ? 4 : 3
  }

  const raw = inflateSync(Buffer.concat(chunks))
  const stride = width * channels
  const pixels = new Uint8Array(height * stride)
  let count = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] ?? 0
    const line = y * (stride + 1) + 1
    const row = y * stride
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? (pixels[row + x - channels] ?? 0) : 0
      const up = y > 0 ? (pixels[row - stride + x] ?? 0) : 0
      const upLeft = x >= channels && y > 0 ? (pixels[row - stride + x - channels] ?? 0) : 0
      pixels[row + x] = ((raw[line + x] ?? 0) + predict(filter, left, up, upLeft)) & 255
    }

    for (let x = 0; x < stride; x += channels) {
      if (matches(pixels[row + x] ?? 0, pixels[row + x + 1] ?? 0, pixels[row + x + 2] ?? 0)) {
        count++
      }
    }
  }

  return count
}
