/*!
 * Parts of this file follow extract-zip (https://github.com/max-mapper/extract-zip):
 *
 * Copyright (c) 2014 Max Ogden and other contributors
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * * Redistributions of source code must retain the above copyright notice, this
 *   list of conditions and the following disclaimer.
 *
 * * Redistributions in binary form must reproduce the above copyright notice,
 *   this list of conditions and the following disclaimer in the documentation
 *   and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
import { createWriteStream } from 'node:fs'
import { mkdir, readdir, realpath, symlink } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { text } from 'node:stream/consumers'
import { pipeline } from 'node:stream/promises'
import { openPromise } from 'yauzl'
import type { Entry, ZipFile } from 'yauzl'

// The file type bits of an entry's unix mode.
const TYPE = 0o170000
const FOLDER = 0o040000
const LINK = 0o120000

// Unpacks a zip into a folder that must be new or empty. It fails rather than write anywhere else:
// - nothing is written through a link, or over something that is already there
// - every link must lead, once everything is unpacked, to something inside the folder
// A failure leaves the folder partly filled, so unpack somewhere that can be thrown away.
export async function unpack(zipPath: string, dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  if ((await readdir(dir)).length > 0) {
    throw new Error(`Can't unpack into ${dir}: it isn't empty`)
  }

  const root = await realpath(dir)
  const links: string[] = []
  const zip = await openPromise(zipPath, { lazyEntries: true })
  try {
    for (let entry = await nextEntry(zip); entry !== undefined; entry = await nextEntry(zip)) {
      await unpackEntry(zip, entry, root, links)
    }
  } finally {
    zip.close()
  }

  // Checked at the end, where links are followed for real: a link can lead outside through
  // another link, which its own text doesn't show. A link that leads nowhere fails here too.
  for (const link of links) {
    if (!isInside(root, await realpath(link))) {
      throw new Error(`Can't unpack ${zipPath}: the link ${link} leads outside ${root}`)
    }
  }
}

function nextEntry(zip: ZipFile): Promise<Entry | undefined> {
  return new Promise((resolve, reject) => {
    const settle = (finish: () => void) => {
      zip.off('entry', onEntry).off('end', onEnd).off('error', onError)
      finish()
    }
    const onEntry = (entry: Entry) => settle(() => resolve(entry))
    const onEnd = () => settle(() => resolve(undefined))
    const onError = (error: Error) => settle(() => reject(error))
    zip.on('entry', onEntry).on('end', onEnd).on('error', onError)
    zip.readEntry()
  })
}

async function unpackEntry(zip: ZipFile, entry: Entry, root: string, links: string[]) {
  const path = resolve(root, entry.fileName)
  // yauzl already refuses names that are absolute or contain "..".
  if (!isInside(root, path)) {
    throw new Error(`Can't unpack ${entry.fileName}: it is outside ${root}`)
  }

  const mode = (entry.externalFileAttributes >> 16) & 0xffff
  // Zips made on Windows mark a folder with a trailing slash or the DOS folder attribute.
  const isFolder =
    (mode & TYPE) === FOLDER ||
    entry.fileName.endsWith('/') ||
    (entry.versionMadeBy >> 8 === 0 && entry.externalFileAttributes === 16)

  const folder = isFolder ? path : dirname(path)
  await mkdir(folder, { recursive: true, mode: isFolder ? permissions(mode, 0o755) : 0o755 })
  if ((await realpath(folder)) !== folder) {
    throw new Error(`Can't unpack ${entry.fileName}: it would be written through a link`)
  }

  if (isFolder) {
    return
  }

  const content = await zip.openReadStreamPromise(entry)
  if ((mode & TYPE) === LINK) {
    const target = await text(content)
    if (!isInside(root, resolve(folder, target))) {
      throw new Error(`Can't unpack ${entry.fileName}: it links to ${target}, outside ${root}`)
    }

    // Fails when something is already at the path.
    await symlink(target, path)
    links.push(path)
    return
  }

  // "wx" fails when something is already at the path, a link included.
  await pipeline(content, createWriteStream(path, { flags: 'wx', mode: permissions(mode, 0o644) }))
}

function isInside(root: string, path: string): boolean {
  const rest = relative(root, path)
  return rest !== '..' && !rest.startsWith(`..${sep}`) && !isAbsolute(rest)
}

// Zips made on Windows carry no unix permissions.
function permissions(mode: number, fallback: number): number {
  return mode & 0o777 || fallback
}
