// tapet's main process. It only creates sessions and their windows, and does what only it can:
// window management, screenshots, dialogs, the menu bar and the daily token cap. Session traffic
// never passes through it.
import { randomBytes } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { createServer, type Socket } from 'node:net'
import { join } from 'node:path'
import {
  BrowserWindow,
  MessageChannelMain,
  app,
  dialog,
  screen,
  utilityProcess,
  type Event,
  type UtilityProcess,
} from 'electron'
import type { WindowSettings } from '@tapet/core'
import {
  PROTOCOL_VERSION,
  TAPET_VERSION,
  controlSocketPath,
  loadUserConfig,
  tapetHome,
  type ControlRequest,
  type ControlResponse,
  type MainToSession,
  type Rect,
  type SessionToMain,
} from '@tapet/protocol'
import sessionEntry from '../session/index.ts?modulePath'
import { createMenuBar, type MenuBar } from './menu-bar.ts'
import { readPreferences, writePreferences } from './preferences.ts'
import { createUsage, type Usage } from './usage.ts'

interface SessionRecord {
  id: string
  token: string
  child: UtilityProcess
  ready: Promise<string>
  window?: BrowserWindow
  settings: WindowSettings
  // Settings already applied to the window, so later updates only change what changed.
  applied: WindowSettings
  frozen: boolean
  closeConfirmed: boolean
}

const sessions = new Map<string, SessionRecord>()
// Set once the user quits, so closing windows doesn't ask about ended sessions.
let quitting = false
// App-wide settings, from the user's own config (a project can't change them).
let usage: Usage | undefined
let menuBar: MenuBar | undefined

function send(
  record: SessionRecord,
  message: MainToSession,
  ports: Electron.MessagePortMain[] = [],
) {
  if (sessions.has(record.id)) {
    record.child.postMessage(message, ports)
  }
}

function titleOf(record: SessionRecord): string {
  return record.settings.name ?? 'tapet'
}

function bringToFront(window: BrowserWindow) {
  window.show()
  window.focus()
  if (process.platform === 'darwin') {
    app.focus({ steal: true })
  }
}

// Closes the window and ends the session's process; reattaching fails after this.
function discard(record: SessionRecord) {
  send(record, { type: 'discard' })
  sessions.delete(record.id)
  record.window?.destroy()
  menuBar?.refresh()
}

function createSession(): SessionRecord {
  const id = `s_${randomBytes(6).toString('base64url')}`
  const token = randomBytes(24).toString('base64url')
  const child = utilityProcess.fork(sessionEntry, [], { serviceName: `tapet session ${id}` })
  let markReady: (url: string) => void = () => undefined
  const record: SessionRecord = {
    id,
    token,
    child,
    ready: new Promise((resolve) => {
      markReady = resolve
    }),
    settings: {},
    applied: {},
    frozen: false,
    closeConfirmed: false,
  }
  sessions.set(id, record)
  child.on('message', (message: SessionToMain) => {
    if (message.type === 'ready') {
      markReady(message.url)
      return
    }

    handleSession(record, message)
  })
  child.on('exit', () => {
    sessions.delete(id)
    record.window?.destroy()
  })
  send(record, { type: 'init', id, token, home: tapetHome() })
  return record
}

function handleSession(record: SessionRecord, message: SessionToMain) {
  if (message.type === 'showWindow') {
    record.settings = message.window
    record.frozen = message.frozen
    showWindow(record, message.focus)
    return
  }

  if (message.type === 'focusWindow') {
    if (record.window) {
      bringToFront(record.window)
    }

    return
  }

  if (message.type === 'capCheck') {
    const { requestId } = message
    void (usage?.check() ?? Promise.resolve({ allowed: true, used: 0, cap: 0 })).then((state) =>
      send(record, { type: 'cap', requestId, ...state }),
    )
    return
  }

  if (message.type === 'tokensUsed') {
    void usage?.add(message.tokens)
    return
  }

  if (message.type === 'discardSelf') {
    discard(record)
    return
  }

  if (message.type === 'screenshot') {
    captureWindow(record, message.requestId, message.rect).catch((error: unknown) => {
      send(record, {
        type: 'screenshot',
        requestId: message.requestId,
        error: `the screenshot failed: ${String(error)}`,
      })
    })
    return
  }

  if (message.type === 'frozen') {
    record.frozen = message.frozen
  }
}

function showWindow(record: SessionRecord, focus: boolean) {
  const { settings } = record
  const existing = record.window
  if (existing && !existing.isDestroyed()) {
    applySettings(record, existing)
    if (focus) {
      bringToFront(existing)
    }

    menuBar?.refresh()
    return
  }

  const window = new BrowserWindow({
    width: settings.width ?? 900,
    height: settings.height ?? 600,
    ...(settings.x !== undefined && settings.y !== undefined
      ? { x: settings.x, y: settings.y }
      : {}),
    alwaysOnTop: settings.always_on_top ?? false,
    title: titleOf(record),
    show: false,
    // In menu-bar mode, windows stay out of the taskbar too.
    skipTaskbar: menuBar !== undefined,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      partition: `tapet-session-${record.id}`,
      sandbox: true,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  })
  record.window = window
  record.applied = { ...settings }
  record.closeConfirmed = false
  window.on('page-title-updated', (event) => event.preventDefault())
  window.on('close', (event) => {
    onWindowClose(record, window, event).catch((error: unknown) => {
      console.error('tapet: closing the window failed', error)
    })
  })
  window.on('closed', () => {
    if (record.window === window) {
      record.window = undefined
    }

    send(record, { type: 'windowClosed' })
    menuBar?.refresh()
  })
  window.webContents.once('did-finish-load', () => {
    const { port1, port2 } = new MessageChannelMain()
    window.webContents.postMessage('tapet-port', null, [port2])
    send(record, { type: 'windowOpened' }, [port1])
    menuBar?.refresh()
    if (focus) {
      bringToFront(window)
      return
    }

    window.showInactive()
  })

  const devServer = process.env.ELECTRON_RENDERER_URL
  if (devServer) {
    void window.loadURL(devServer)
    return
  }

  void window.loadFile(join(import.meta.dirname, '../renderer/index.html'))
}

// Applies only the settings that changed, so a CSS-only update doesn't undo the user's resizing.
function applySettings(record: SessionRecord, window: BrowserWindow) {
  const { settings, applied } = record
  window.setTitle(titleOf(record))
  if (settings.width !== applied.width || settings.height !== applied.height) {
    const [width = 900, height = 600] = window.getSize()
    window.setSize(settings.width ?? width, settings.height ?? height)
  }

  if (
    (settings.x !== applied.x || settings.y !== applied.y) &&
    settings.x !== undefined &&
    settings.y !== undefined
  ) {
    window.setPosition(settings.x, settings.y)
  }

  if (settings.always_on_top !== applied.always_on_top) {
    window.setAlwaysOnTop(settings.always_on_top ?? false)
  }

  record.applied = { ...settings }
}

async function onWindowClose(record: SessionRecord, window: BrowserWindow, event: Event) {
  if (quitting || !record.frozen || record.closeConfirmed) {
    return
  }

  event.preventDefault()
  const choice = await frozenCloseChoice(window)
  if (choice === 'discard') {
    discard(record)
    return
  }

  record.closeConfirmed = true
  window.close()
}

async function frozenCloseChoice(window: BrowserWindow): Promise<'discard' | 'keep'> {
  const preferences = await readPreferences()
  if (preferences.frozenWindowClose) {
    return preferences.frozenWindowClose
  }

  const { response, checkboxChecked } = await dialog.showMessageBox(window, {
    type: 'question',
    buttons: ['Discard', 'Keep'],
    defaultId: 0,
    cancelId: 1,
    message: 'This session has ended. Discard it?',
    detail:
      'Discarding frees its memory, and agents can no longer reattach to it. Keeping it lets an agent reattach until you quit tapet.',
    checkboxLabel: 'Remember this choice',
    checkboxChecked: false,
  })
  const choice = response === 0 ? 'discard' : 'keep'
  if (checkboxChecked) {
    await writePreferences({ ...preferences, frozenWindowClose: choice })
  }

  return choice
}

async function captureWindow(record: SessionRecord, requestId: number, rect?: Rect) {
  const { window } = record
  const reply = (result: { png?: Uint8Array; error?: string }) =>
    send(record, { type: 'screenshot', requestId, ...result })
  if (!window || window.isDestroyed() || !window.isVisible()) {
    reply({ error: 'the window is closed; call window_focus to reopen it' })
    return
  }

  if (window.isMinimized()) {
    reply({ error: 'the window is minimized; call window_focus to show it' })
    return
  }

  const image = await window.webContents.capturePage(rect)
  const { scaleFactor } = screen.getDisplayMatching(window.getBounds())
  reply({ png: new Uint8Array(image.toPNG({ scaleFactor })) })
}

async function handleControl(socket: Socket, line: string) {
  const respond = (response: ControlResponse) => socket.write(`${JSON.stringify(response)}\n`)
  let request: ControlRequest
  try {
    request = JSON.parse(line) as ControlRequest
  } catch {
    // Not one of tapet's own clients; there's no id to answer to.
    socket.destroy()
    return
  }

  if (request.type === 'hello') {
    respond({ id: request.id, ok: true, protocol: PROTOCOL_VERSION, appVersion: TAPET_VERSION })
    return
  }

  if (request.type === 'createSession') {
    const record = createSession()
    respond({
      id: request.id,
      ok: true,
      session: { id: record.id, token: record.token, url: await record.ready },
    })
    return
  }

  const record = sessions.get(request.session)
  if (!record) {
    respond({
      id: request.id,
      ok: false,
      error: `there is no tapet session "${request.session}": it was discarded, or tapet was quit since`,
    })
    return
  }

  respond({
    id: request.id,
    ok: true,
    session: { id: record.id, token: record.token, url: await record.ready },
  })
}

async function startControlServer() {
  const path = controlSocketPath()
  await mkdir(tapetHome(), { recursive: true })
  if (process.platform !== 'win32') {
    // A leftover from a crash. The single-instance lock guarantees no other tapet uses it.
    await rm(path, { force: true })
  }

  createServer((socket) => {
    let buffer = ''
    socket.setEncoding('utf8')
    socket.on('error', () => socket.destroy())
    socket.on('data', (chunk: string) => {
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines.filter((candidate) => candidate.trim() !== '')) {
        handleControl(socket, line).catch((error: unknown) => {
          console.error('tapet: control request failed', error)
        })
      }
    })
  }).listen(path)
}

app.setName('tapet')
// Electron's own data lives in tapet's home, which also makes the single-instance lock per home:
// a test with its own TAPET_HOME never collides with the tapet you use.
app.setPath('userData', join(tapetHome(), 'app-data'))
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // tapet keeps running with no windows open, until the user quits it.
  app.on('window-all-closed', () => undefined)
  app.on('before-quit', () => {
    quitting = true
  })
  app
    .whenReady()
    .then(async () => {
      const { config, issues } = await loadUserConfig()
      for (const issue of issues) {
        console.error(`tapet config: ${issue}`)
      }

      usage = createUsage({ path: join(tapetHome(), 'usage.json'), cap: config.daily_token_cap })
      if (config.app_presence === 'menu_bar') {
        menuBar = createMenuBar(() =>
          [...sessions.values()].flatMap((record) => (record.window ? [record.window] : [])),
        )
      }

      await startControlServer()
    })
    .catch((error: unknown) => {
      console.error('tapet: failed to start', error)
      app.exit(1)
    })
}
