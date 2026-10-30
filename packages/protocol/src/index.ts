// How tapet's processes find and talk to each other: `tapet mcp` (the MCP server the harness
// starts), the app's main process, each session's background process, and each session's window.
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const TAPET_VERSION = '0.1.0'

// Bump when these processes stop understanding each other. A mismatch makes `tapet mcp` refuse
// to talk to an already running app.
export const PROTOCOL_VERSION = 1

// The Electron release tapet runs on. `tapet setup` downloads exactly this one.
export const ELECTRON_VERSION = '45.2.0'

// Everything tapet keeps on disk. TAPET_HOME overrides it, which isolates tests.
export function tapetHome(): string {
  return process.env.TAPET_HOME ?? join(homedir(), '.tapet')
}

export function controlSocketPath(home = tapetHome()): string {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\tapet-${createHash('sha256').update(home).digest('hex').slice(0, 16)}`
  }

  return join(home, 'app.sock')
}

export function sessionLogPath(session: string, home = tapetHome()): string {
  return join(home, 'logs', `${session}.log`)
}

export function electronDir(home = tapetHome()): string {
  return join(home, 'electron', ELECTRON_VERSION)
}

export function preferencesPath(home = tapetHome()): string {
  return join(home, 'preferences.json')
}

export type * from './messages.ts'
