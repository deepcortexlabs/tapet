// Messages between tapet's processes. Types only, so the window's browser code can use them too.
import type { Change, Entry, PanelSettings, WindowSettings } from '@tapet/core'

export interface SessionAddress {
  id: string
  // Base URL of the session's HTTP server, e.g. http://127.0.0.1:53211
  url: string
  token: string
}

// tapet mcp → main process: one JSON object per line over the control socket.
export type ControlRequest =
  | { id: number; type: 'hello'; protocol: number }
  | { id: number; type: 'createSession' }
  | { id: number; type: 'attachSession'; session: string }

export type ControlResponse =
  | { id: number; ok: true; protocol?: number; appVersion?: string; session?: SessionAddress }
  | { id: number; ok: false; error: string }

// tapet mcp → session process: POST /rpc, only from the attached client.
export type RpcMethod =
  | 'windowUpdate'
  | 'windowGet'
  | 'windowFocus'
  | 'windowScreenshot'
  | 'windowInspect'
  | 'panelCreate'
  | 'panelUpdate'
  | 'panelRemove'
  | 'channelWrite'
  | 'sessionEnd'
  | 'sessionConfigure'
  | 'smartRun'
  | 'smartRead'

export interface RpcRequest {
  method: RpcMethod
  params?: unknown
}

export interface RpcFailure {
  message: string
  issues?: Array<{ path: string; message: string }>
}

// Notices are errors that happened since the last call (render errors, malformed pipes). They
// ride on every response, so the agent sees them with its next tool result.
export type RpcResponse =
  | { ok: true; result: unknown; notices: string[] }
  | { ok: false; error: RpcFailure; notices: string[] }

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface PanelGeometry extends Rect {
  id: string
  overflow: boolean
  zeroSize: boolean
  // The user expanded the panel over the window (by double-clicking its title bar): its box is the
  // expanded one, not its place in the layout.
  expanded?: true
}

export interface Geometry {
  window: { width: number; height: number }
  panels: PanelGeometry[]
}

// attached: an agent's MCP connection holds the session. detached: the connection closed, but the
// session keeps running until its idle timeout. ended: panels are frozen and pipes refused.
export type SessionState = 'attached' | 'detached' | 'ended'

// Session process ↔ main process, over the utility process's parentPort.
export type SessionToMain =
  | { type: 'ready'; url: string }
  // Creates, updates or reopens the window, taking focus if asked. A new window's port arrives
  // with 'windowOpened'.
  | { type: 'showWindow'; window: WindowSettings; state: SessionState; focus: boolean }
  | { type: 'focusWindow' }
  | { type: 'screenshot'; requestId: number; rect?: Rect }
  | { type: 'state'; state: SessionState }
  // The session ended and its config says to remove its panels: close the window, end the process.
  | { type: 'discardSelf' }
  // Before a smart run: may it spend tokens under the daily cap?
  | { type: 'capCheck'; requestId: number }
  | { type: 'tokensUsed'; tokens: number }

export type MainToSession =
  | { type: 'init'; id: string; token: string; home: string }
  // Carries the window's MessagePort.
  | { type: 'windowOpened' }
  | { type: 'windowClosed' }
  | { type: 'screenshot'; requestId: number; png?: Uint8Array; error?: string }
  | { type: 'discard' }
  | { type: 'cap'; requestId: number; allowed: boolean; used: number; cap: number }

export interface SmartOutput {
  at: number
  model: string
  tokens: number
  text?: string
  error?: string
}

export type SmartStatus = 'idle' | 'running' | 'cap reached' | 'error'

export interface SmartView {
  status: SmartStatus
  latest?: SmartOutput
}

export interface PanelSnapshot {
  settings: PanelSettings
  entries: Entry[]
  // Whether a pipe is feeding the panel right now.
  live: boolean
  smart?: SmartView
}

// Session process ↔ window, over the window's MessagePort.
export type SessionToWindow =
  | {
      type: 'snapshot'
      window: WindowSettings
      panels: PanelSnapshot[]
      state: SessionState
      // When the session ended, in milliseconds since 1970.
      endedAt?: number
    }
  | { type: 'window'; window: WindowSettings }
  | { type: 'panelAdded'; panel: PanelSnapshot }
  | { type: 'panelUpdated'; settings: PanelSettings }
  | { type: 'panelRemoved'; id: string }
  // Change sets per panel, in the order they happened.
  | { type: 'changes'; panels: Record<string, Change[]> }
  | { type: 'state'; state: SessionState; endedAt?: number }
  | { type: 'geometry'; requestId: number }
  | { type: 'panelLive'; panel: string; live: boolean }
  | { type: 'smart'; panel: string; smart?: SmartView }

export type WindowToSession =
  // Sent after a panel is mounted or its settings are applied.
  | { type: 'rendered'; panel: string; error?: string }
  | { type: 'error'; panel?: string; message: string }
  | { type: 'geometry'; requestId: number; geometry: Geometry }
