import { existsSync } from 'node:fs'
import { download } from '@electron/get'
import extract from 'extract-zip'
import { ELECTRON_VERSION, electronDir } from '@tapet/protocol'
import { electronBinary } from './paths.ts'

// `tapet setup`: downloads tapet's pinned Electron in the foreground, showing progress.
export async function runSetup(): Promise<number> {
  const target = electronDir()
  if (existsSync(electronBinary(target))) {
    process.stdout.write(`tapet is set up: Electron ${ELECTRON_VERSION} is in ${target}\n`)
    return 0
  }

  process.stdout.write(`Downloading Electron ${ELECTRON_VERSION} (about 100 MB)…\n`)
  const zip = await download(ELECTRON_VERSION)
  await extract(zip, { dir: target })
  process.stdout.write(`tapet is set up: Electron ${ELECTRON_VERSION} is in ${target}\n`)
  return 0
}
