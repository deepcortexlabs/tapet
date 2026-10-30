import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { electronDir } from '@tapet/protocol'

// Errors meant for the agent or user as they are.
export class TapetError extends Error {}

// Runs this very tapet again (Node plus this CLI's entry file), so commands handed to agents work
// without a global install and always match the running version.
export function selfCommand(): string[] {
  return [process.execPath, join(import.meta.dirname, 'main.ts')]
}

export function commandLine(args: string[]): string {
  return args.map(quote).join(' ')
}

function quote(arg: string): string {
  if (/^[\w@%+=:,./-]+$/.test(arg)) {
    return arg
  }

  if (process.platform === 'win32') {
    return `"${arg.replaceAll('"', '\\"')}"`
  }

  return `'${arg.replaceAll("'", "'\\''")}'`
}

// The built Electron app (its package.json points Electron at out/main/index.js).
export function appDir(): string {
  return dirname(fileURLToPath(import.meta.resolve('@tapet/app/package.json')))
}

export function electronBinary(dir: string): string {
  if (process.platform === 'darwin') {
    return join(dir, 'Electron.app', 'Contents', 'MacOS', 'Electron')
  }

  if (process.platform === 'win32') {
    return join(dir, 'electron.exe')
  }

  return join(dir, 'electron')
}

// TAPET_ELECTRON, then the copy `tapet setup` downloaded, then the workspace's electron package.
export function findElectron(): string | undefined {
  const candidates = [
    process.env.TAPET_ELECTRON,
    electronBinary(electronDir()),
    workspaceElectron(),
  ]
  return candidates.find((candidate) => candidate !== undefined && existsSync(candidate))
}

function workspaceElectron(): string | undefined {
  try {
    return createRequire(join(appDir(), 'package.json'))('electron') as string
  } catch {
    // Not a development checkout: only the downloaded Electron is available.
    return undefined
  }
}
