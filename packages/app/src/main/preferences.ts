// Choices the user asked tapet to remember. The app writes this file; the config stays the user's.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { preferencesPath } from '@tapet/protocol'

export interface Preferences {
  // What closing the window of a session no agent holds (detached or ended) does, once the user
  // ticked "Remember this choice".
  frozenWindowClose?: 'discard' | 'keep'
}

export async function readPreferences(): Promise<Preferences> {
  try {
    return JSON.parse(await readFile(preferencesPath(), 'utf8')) as Preferences
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('tapet: ignoring unreadable preferences', error)
    }

    return {}
  }
}

export async function writePreferences(preferences: Preferences): Promise<void> {
  await mkdir(dirname(preferencesPath()), { recursive: true })
  await writeFile(preferencesPath(), `${JSON.stringify(preferences, null, 2)}\n`)
}
