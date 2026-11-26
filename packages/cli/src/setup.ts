import { existsSync, readdirSync } from 'node:fs'
import { cp, mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { download } from '@electron/get'
import { ELECTRON_VERSION, electronDir } from '@tapet/protocol'
import { unpack } from './extract.ts'
import { electronBinary } from './paths.ts'

// `tapet setup`: downloads tapet's pinned Electron in the foreground, showing progress.
export async function runSetup(): Promise<number> {
  const target = electronDir()
  if (existsSync(electronBinary(target))) {
    process.stdout.write(`tapet is set up: Electron ${ELECTRON_VERSION} is in ${target}\n`)
    return 0
  }

  if (existsSync(target) && readdirSync(target).length > 0) {
    process.stderr.write(
      `${target} has files but no Electron. Delete that folder, then run tapet setup again.\n`,
    )
    return 1
  }

  process.stdout.write(`Downloading Electron ${ELECTRON_VERSION} (about 100 MB)…\n`)
  await unpackInto(await download(ELECTRON_VERSION), target)
  process.stdout.write(`tapet is set up: Electron ${ELECTRON_VERSION} is in ${target}\n`)
  return 0
}

// Unpacks a zip in the system's temporary folder and moves the result to `target` only when it is
// complete, so an interrupted or failed unpack leaves nothing at `target`.
export async function unpackInto(zip: string, target: string): Promise<void> {
  const unpacked = await mkdtemp(join(tmpdir(), 'tapet-electron-'))
  try {
    await unpack(zip, unpacked)
    await moveIntoPlace(unpacked, target)
  } finally {
    // Still there after a failure, or when it was copied instead of moved.
    await rm(unpacked, { recursive: true, force: true })
  }
}

// Makes the unpacked folder appear at its place in one step.
async function moveIntoPlace(from: string, to: string): Promise<void> {
  await mkdir(dirname(to), { recursive: true })
  try {
    await rename(from, to)
    return
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') {
      throw error
    }
  }

  // The temporary folder is on another disk, where a move isn't possible: copy it next to its
  // place first, which can be interrupted, then move the copy.
  const incoming = `${to}.incoming`
  await cp(from, incoming, { recursive: true, verbatimSymlinks: true })
  await rename(incoming, to)
}
