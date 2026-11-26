import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32, deflateRawSync } from 'node:zlib'
import { expect, it } from 'vitest'
import { unpack } from '../src/extract.ts'
import { unpackInto } from '../src/setup.ts'

const FILE = 0o100644
const PROGRAM = 0o100755
const FOLDER = 0o040755
const LINK = 0o120777

type Item = { name: string; mode: number; data?: string }

// A zip with these entries, in this order. The library that writes zips for a living refuses to
// write the hostile ones these tests need.
function zip(items: Item[]): Buffer {
  const locals: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const item of items) {
    const name = Buffer.from(item.name)
    const data = Buffer.from(item.data ?? '')
    const deflate = (item.mode & 0o170000) === 0o100000
    const body = deflate ? deflateRawSync(data) : data

    // Version needed, UTF-8 names, method, time and date, checksum, sizes, name and extra lengths.
    const shared = Buffer.alloc(26)
    shared.writeUInt16LE(20, 0)
    shared.writeUInt16LE(0x0800, 2)
    shared.writeUInt16LE(deflate ? 8 : 0, 4)
    shared.writeUInt32LE(crc32(data), 10)
    shared.writeUInt32LE(body.length, 14)
    shared.writeUInt32LE(data.length, 18)
    shared.writeUInt16LE(name.length, 22)

    const local = Buffer.concat([Buffer.from('PK\x03\x04'), shared, name, body])
    locals.push(local)

    // Made on unix, then the entry's mode and where its local header starts.
    const made = Buffer.alloc(2)
    made.writeUInt16LE((3 << 8) | 20)
    const rest = Buffer.alloc(14)
    rest.writeUInt32LE((item.mode * 0x10000) >>> 0, 6)
    rest.writeUInt32LE(offset, 10)
    central.push(Buffer.concat([Buffer.from('PK\x01\x02'), made, shared, rest, name]))
    offset += local.length
  }

  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.write('PK\x05\x06', 'latin1')
  end.writeUInt16LE(items.length, 8)
  end.writeUInt16LE(items.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

// A zip of these entries, next to the folder it is unpacked into.
function scene(items: Item[]) {
  const dir = mkdtempSync(join(tmpdir(), 'tapet-unpack-'))
  const zipPath = join(dir, 'test.zip')
  writeFileSync(zipPath, zip(items))
  return { dir, zipPath, out: join(dir, 'out') }
}

it('unpacks files and folders', async () => {
  const { zipPath, out } = scene([
    { name: 'a.txt', mode: FILE, data: 'hello' },
    { name: 'empty/', mode: FOLDER },
    { name: 'docs/deep/b.txt', mode: FILE, data: 'deep '.repeat(1000) },
  ])
  await unpack(zipPath, out)
  expect(readFileSync(join(out, 'a.txt'), 'utf8')).toBe('hello')
  expect(statSync(join(out, 'empty')).isDirectory()).toBe(true)
  expect(readFileSync(join(out, 'docs', 'deep', 'b.txt'), 'utf8')).toBe('deep '.repeat(1000))
})

// A program, a text file, a link to their folder and a link that reaches the program through it.
const TREE: Item[] = [
  { name: 'versions/a/tool', mode: PROGRAM, data: '#!/bin/sh\n' },
  { name: 'versions/a/notes.txt', mode: FILE, data: 'notes' },
  { name: 'versions/current', mode: LINK, data: 'a' },
  { name: 'tool', mode: LINK, data: 'versions/current/tool' },
]

function expectTree(dir: string) {
  expect(readlinkSync(join(dir, 'versions', 'current'))).toBe('a')
  expect(readFileSync(join(dir, 'tool'), 'utf8')).toBe('#!/bin/sh\n')
  expect(readFileSync(join(dir, 'versions', 'a', 'notes.txt'), 'utf8')).toBe('notes')
  // Windows has no executable permission.
  if (process.platform !== 'win32') {
    expect(statSync(join(dir, 'versions', 'a', 'tool')).mode & 0o111).toBe(0o111)
    expect(statSync(join(dir, 'versions', 'a', 'notes.txt')).mode & 0o111).toBe(0)
  }
}

// The folders `tapet setup` unpacks in, inside the system's temporary folder.
function unpackingFolders(): string[] {
  return readdirSync(tmpdir()).filter((name) => name.startsWith('tapet-electron-'))
}

it('keeps links and executable permissions', async () => {
  const { zipPath, out } = scene(TREE)
  await unpack(zipPath, out)
  expectTree(out)
})

// GHSA-jmr9-qjv8-65gv
it('refuses a link that leads outside the folder', async () => {
  const { zipPath, out } = scene([{ name: 'evil', mode: LINK, data: '../../outside.txt' }])
  await expect(unpack(zipPath, out)).rejects.toThrow(/outside/)
  expect(readdirSync(out)).toEqual([])
})

// GHSA-7pqw-9j4j-h8q3: a link, then a file of the same name that would be written through it.
it('refuses a second entry with the name of a link', async () => {
  const { zipPath, out } = scene([
    { name: 'target.txt', mode: FILE, data: 'original' },
    { name: 'door', mode: LINK, data: 'target.txt' },
    { name: 'door', mode: FILE, data: 'overwritten' },
  ])
  await expect(unpack(zipPath, out)).rejects.toThrow(/EEXIST/)
  expect(readFileSync(join(out, 'target.txt'), 'utf8')).toBe('original')
})

it('refuses an entry written through a link', async () => {
  const { zipPath, out } = scene([
    { name: 'real/', mode: FOLDER },
    { name: 'door', mode: LINK, data: 'real' },
    { name: 'door/file.txt', mode: FILE, data: 'through' },
  ])
  await expect(unpack(zipPath, out)).rejects.toThrow(/through a link/)
  expect(readdirSync(join(out, 'real'))).toEqual([])
})

// Each link's own text stays inside the folder: together they lead to its parent.
it('refuses a link that leaves the folder through another link', async () => {
  const { zipPath, out } = scene([
    { name: 'sub/up', mode: LINK, data: '..' },
    { name: 'escape', mode: LINK, data: 'sub/up/..' },
  ])
  await expect(unpack(zipPath, out)).rejects.toThrow(/leads outside/)
})

it('refuses a name that leaves the folder', async () => {
  const { dir, zipPath, out } = scene([{ name: '../evil.txt', mode: FILE, data: 'evil' }])
  await expect(unpack(zipPath, out)).rejects.toThrow()
  expect(existsSync(join(dir, 'evil.txt'))).toBe(false)
})

it('refuses a folder that already has something in it', async () => {
  const { zipPath, out } = scene([{ name: 'a.txt', mode: FILE, data: 'hello' }])
  mkdirSync(out)
  writeFileSync(join(out, 'mine.txt'), 'mine')
  await expect(unpack(zipPath, out)).rejects.toThrow(/isn't empty/)
  expect(readdirSync(out)).toEqual(['mine.txt'])
})

it('moves what it unpacked into place and removes its temporary folder', async () => {
  const { dir, zipPath } = scene(TREE)
  const before = unpackingFolders()
  await unpackInto(zipPath, join(dir, 'home', 'electron'))
  expectTree(join(dir, 'home', 'electron'))
  expect(unpackingFolders()).toEqual(before)
})

it('puts nothing in place when unpacking fails, and removes its temporary folder', async () => {
  const { dir, zipPath } = scene([
    { name: 'fine.txt', mode: FILE, data: 'fine' },
    { name: 'evil', mode: LINK, data: '../../outside.txt' },
  ])
  const before = unpackingFolders()
  await expect(unpackInto(zipPath, join(dir, 'home', 'electron'))).rejects.toThrow(/outside/)
  expect(existsSync(join(dir, 'home'))).toBe(false)
  expect(unpackingFolders()).toEqual(before)
})

// `tapet setup` unpacks in the system's temporary folder, which can be on another disk than
// tapet's home: there the folder can't be moved, only copied. CI provides a folder on a second
// disk on every platform (see ci.yml) and fails without one. Elsewhere this is skipped.
const otherDisk = process.env.TAPET_TEST_OTHER_DISK
it.skipIf(otherDisk === undefined && process.env.CI === undefined)(
  'moves what it unpacked into place on another disk',
  async () => {
    if (otherDisk === undefined) {
      throw new Error('TAPET_TEST_OTHER_DISK is not set: CI must provide a second disk')
    }

    expect(statSync(otherDisk).dev).not.toBe(statSync(tmpdir()).dev)
    const target = join(mkdtempSync(join(otherDisk, 'tapet-home-')), 'electron')
    const { zipPath } = scene(TREE)
    const before = unpackingFolders()
    await unpackInto(zipPath, target)
    expectTree(target)
    expect(readdirSync(join(target, '..'))).toEqual(['electron'])
    expect(unpackingFolders()).toEqual(before)
  },
)
