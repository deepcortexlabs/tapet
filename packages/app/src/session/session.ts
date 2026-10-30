// A session's background process: holds its panels and data, serves pipes and RPC over localhost
// HTTP, and drives its window through the main process. Plain Node, so it's tested without Electron.
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { appendFile, mkdir } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname } from 'node:path'
import {
  createDecoder,
  createStore,
  validateCreate,
  validateUpdate,
  validateWindowUpdate,
  type Change,
  type DecodeResult,
  type Issue,
  type PanelSettings,
  type Store,
  type WindowSettings,
} from '@tapet/core'
import type {
  Geometry,
  MainToSession,
  PanelSnapshot,
  Rect,
  RpcMethod,
  RpcRequest,
  RpcResponse,
  SessionToMain,
  SessionToWindow,
  WindowToSession,
} from '@tapet/protocol'

export interface MainLink {
  send(message: SessionToMain): void
}

// The session's end of the window's MessagePort.
export interface WindowPort {
  post(message: SessionToWindow): void
  onMessage(listener: (message: WindowToSession) => void): void
}

export interface SessionOptions {
  id: string
  token: string
  logPath: string
  main: MainLink
  // How long panel_create and panel_update wait for the window to confirm a render.
  renderTimeoutMs?: number
}

export interface Session {
  // Starts the HTTP server and resolves with its base URL.
  listen(): Promise<string>
  handleMain(message: MainToSession, port?: WindowPort): void
  close(): Promise<void>
}

interface Panel {
  settings: PanelSettings
  store: Store
  channel: string
  pipes: Set<IncomingMessage>
}

class RpcError extends Error {
  issues: Issue[] | undefined

  constructor(message: string, issues?: Issue[]) {
    super(message)
    this.issues = issues
  }
}

const WINDOW_CLOSED = 'the window is closed; call window_focus to reopen it'
const MAX_RPC_BYTES = 64 * 1024 * 1024
const FLUSH_MS = 16

export function createSession(options: SessionOptions): Session {
  const { id, main } = options
  const renderTimeoutMs = options.renderTimeoutMs ?? 3000
  const panels = new Map<string, Panel>()
  const channels = new Map<string, Panel>()
  const notices: string[] = []
  let window: WindowSettings = {}
  let frozen = false
  let attachment: string | undefined
  let port: WindowPort | undefined
  let address = ''
  let requestCounter = 0
  let windowWaiters: Array<() => void> = []
  const renders = new Map<string, Array<(error?: string) => void>>()
  const geometryRequests = new Map<number, (geometry?: Geometry) => void>()
  const screenshots = new Map<number, (result: { png?: Uint8Array; error?: string }) => void>()
  const queued = new Map<string, Change[]>()
  let flushTimer: ReturnType<typeof setTimeout> | undefined
  let logWrite: Promise<void> = mkdir(dirname(options.logPath), { recursive: true }).then(
    () => undefined,
  )

  function log(event: string, details: Record<string, unknown> = {}) {
    const line = `${new Date().toISOString()} ${event} ${JSON.stringify(details)}\n`
    logWrite = logWrite
      .then(() => appendFile(options.logPath, line))
      .catch((error: unknown) => {
        console.error('tapet: cannot write the session log', error)
      })
  }

  function notice(message: string) {
    notices.push(message)
    log('notice', { message })
  }

  function flush() {
    flushTimer = undefined
    if (queued.size === 0) {
      return
    }

    port?.post({ type: 'changes', panels: Object.fromEntries(queued) })
    queued.clear()
  }

  // Sends a message after any queued changes, so the window sees everything in order.
  function postNow(message: SessionToWindow) {
    flush()
    port?.post(message)
  }

  function queue(panelId: string, change: Change) {
    const empty =
      change.added.length === 0 && change.updated.length === 0 && change.removed.length === 0
    if (!port || empty) {
      return
    }

    queued.set(panelId, [...(queued.get(panelId) ?? []), change])
    flushTimer ??= setTimeout(flush, FLUSH_MS)
  }

  function snapshotOf(panel: Panel): PanelSnapshot {
    return { settings: panel.settings, entries: panel.store.entries() }
  }

  // Creates, updates or reopens the window. Resolves once it's open and has the current state.
  function showWindow(): Promise<void> {
    main.send({ type: 'showWindow', window, frozen })
    if (port) {
      postNow({ type: 'window', window })
      return Promise.resolve()
    }

    return new Promise((resolve) => {
      windowWaiters.push(resolve)
    })
  }

  // Reopens the window if needed; returns whether it just opened, in which case its snapshot
  // already holds the latest state.
  async function ensureWindow(): Promise<boolean> {
    if (port) {
      return false
    }

    await showWindow()
    return true
  }

  function openWindow(windowPort: WindowPort) {
    port = windowPort
    windowPort.onMessage(handleWindowMessage)
    queued.clear()
    windowPort.post({
      type: 'snapshot',
      window,
      frozen,
      panels: [...panels.values()].map(snapshotOf),
    })
    const waiters = windowWaiters
    windowWaiters = []
    for (const resolve of waiters) {
      resolve()
    }

    log('window opened')
  }

  function closeWindow() {
    port = undefined
    queued.clear()
    for (const resolvers of renders.values()) {
      for (const resolve of resolvers) {
        resolve()
      }
    }

    renders.clear()
    for (const resolve of geometryRequests.values()) {
      resolve()
    }

    geometryRequests.clear()
    log('window closed')
  }

  function handleWindowMessage(message: WindowToSession) {
    if (message.type === 'rendered') {
      const resolvers = renders.get(message.panel) ?? []
      renders.delete(message.panel)
      for (const resolve of resolvers) {
        resolve(message.error)
      }

      if (message.error) {
        log('render error', { panel: message.panel, error: message.error })
      }

      return
    }

    if (message.type === 'error') {
      notice(message.panel ? `panel "${message.panel}": ${message.message}` : message.message)
      return
    }

    geometryRequests.get(message.requestId)?.(message.geometry)
    geometryRequests.delete(message.requestId)
  }

  // Resolves with the render error, or nothing once rendered or after the timeout.
  function waitForRender(panelId: string): Promise<string | undefined> {
    return new Promise((resolve) => {
      const done = (error?: string) => {
        clearTimeout(timer)
        resolve(error)
      }
      const timer = setTimeout(() => {
        renders.set(
          panelId,
          (renders.get(panelId) ?? []).filter((waiting) => waiting !== done),
        )
        resolve(undefined)
      }, renderTimeoutMs)
      renders.set(panelId, [...(renders.get(panelId) ?? []), done])
    })
  }

  function geometry(): Promise<Geometry> {
    const windowPort = port
    if (!windowPort) {
      return Promise.reject(new RpcError(WINDOW_CLOSED))
    }

    requestCounter += 1
    const requestId = requestCounter
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        geometryRequests.delete(requestId)
        reject(new RpcError('the window did not answer in time'))
      }, renderTimeoutMs)
      geometryRequests.set(requestId, (result) => {
        clearTimeout(timer)
        if (!result) {
          reject(new RpcError(WINDOW_CLOSED))
          return
        }

        resolve(result)
      })
      postNow({ type: 'geometry', requestId })
    })
  }

  function screenshot(rect?: Rect): Promise<Uint8Array> {
    requestCounter += 1
    const requestId = requestCounter
    return new Promise((resolve, reject) => {
      screenshots.set(requestId, (result) => {
        if (!result.png) {
          reject(new RpcError(result.error ?? 'the screenshot failed'))
          return
        }

        resolve(result.png)
      })
      main.send(rect ? { type: 'screenshot', requestId, rect } : { type: 'screenshot', requestId })
    })
  }

  function freeze(reason: string) {
    if (frozen) {
      return
    }

    frozen = true
    for (const panel of panels.values()) {
      for (const pipe of panel.pipes) {
        pipe.destroy()
      }

      panel.pipes.clear()
    }

    main.send({ type: 'frozen', frozen: true })
    postNow({ type: 'frozen', frozen: true })
    log('session ended', { reason })
  }

  function unfreeze() {
    frozen = false
    main.send({ type: 'frozen', frozen: false })
    postNow({ type: 'frozen', frozen: false })
    log('session resumed')
  }

  function panelFor(params: unknown, field = 'id'): Panel {
    const panelId = isRecord(params) ? params[field] : undefined
    if (typeof panelId !== 'string') {
      throw new RpcError(`${field} must be the id of a panel`)
    }

    const panel = panels.get(panelId)
    if (!panel) {
      throw new RpcError(`there is no panel "${panelId}"`)
    }

    return panel
  }

  // Applies decoded items to a panel. Returns why decoding must stop, if it must.
  function ingest(
    panel: Panel,
    result: DecodeResult,
    ignoreMalformed: boolean,
  ): string | undefined {
    if (result.items.length > 0) {
      const applied = panel.store.apply(result.items, Date.now(), {
        ignoreInvalid: ignoreMalformed,
      })
      queue(panel.settings.id, applied.change)
      if (applied.error) {
        return applied.error.message
      }
    }

    if (result.error) {
      const { line, message, sample } = result.error
      return `line ${line}: ${message} (${sample})`
    }

    return undefined
  }

  const methods: Record<RpcMethod, (params: unknown) => Promise<unknown>> = {
    async windowUpdate(params) {
      const { settings, issues } = validateWindowUpdate(window, params)
      if (!settings) {
        throw new RpcError('invalid window settings', issues)
      }

      window = settings
      log('window updated', { window })
      await showWindow()
      return { session: id }
    },

    async windowGet() {
      return { session: id, window, panels: [...panels.values()].map((panel) => panel.settings) }
    },

    async windowFocus() {
      await ensureWindow()
      main.send({ type: 'focusWindow' })
      return { session: id }
    },

    async windowScreenshot(params) {
      if (!port) {
        throw new RpcError(WINDOW_CLOSED)
      }

      const panelId = isRecord(params) ? params.panel : undefined
      if (panelId === undefined) {
        return { png: Buffer.from(await screenshot()).toString('base64') }
      }

      const found = (await geometry()).panels.find((panel) => panel.id === panelId)
      if (!found) {
        throw new RpcError(`there is no panel "${String(panelId)}"`)
      }

      const { x, y, width, height } = found
      return { png: Buffer.from(await screenshot({ x, y, width, height })).toString('base64') }
    },

    async windowInspect() {
      return await geometry()
    },

    async panelCreate(params) {
      const { settings, issues } = validateCreate(params)
      if (!settings) {
        throw new RpcError('invalid panel settings', issues)
      }

      if (panels.has(settings.id)) {
        throw new RpcError(
          `a panel with id "${settings.id}" already exists; use panel_update to change it`,
        )
      }

      const panel: Panel = {
        settings,
        store: createStore(settings),
        channel: randomToken(),
        pipes: new Set(),
      }
      panels.set(settings.id, panel)
      channels.set(panel.channel, panel)
      log('panel created', { settings })
      const rendered = waitForRender(settings.id)
      if (!(await ensureWindow())) {
        postNow({ type: 'panelAdded', panel: snapshotOf(panel) })
      }

      const renderError = await rendered
      if (renderError) {
        throw new RpcError(`panel "${settings.id}" failed to render: ${renderError}`)
      }

      return { channel: `${address}/c/${panel.channel}` }
    },

    async panelUpdate(params) {
      const panel = panelFor(params)
      const changes = Object.fromEntries(
        Object.entries(params as Record<string, unknown>).filter(([name]) => name !== 'id'),
      )
      const { settings, issues } = validateUpdate(panel.settings, changes)
      if (!settings) {
        throw new RpcError('invalid panel settings', issues)
      }

      if (JSON.stringify(settings.retention) !== JSON.stringify(panel.settings.retention)) {
        queue(settings.id, panel.store.setRetention(settings.retention, Date.now()))
      }

      panel.settings = settings
      log('panel updated', { settings })
      const rendered = waitForRender(settings.id)
      if (!(await ensureWindow())) {
        postNow({ type: 'panelUpdated', settings })
      }

      const renderError = await rendered
      if (renderError) {
        throw new RpcError(`panel "${settings.id}" failed to render: ${renderError}`)
      }

      return { id: settings.id }
    },

    async panelRemove(params) {
      const panel = panelFor(params)
      for (const pipe of panel.pipes) {
        pipe.destroy()
      }

      panels.delete(panel.settings.id)
      channels.delete(panel.channel)
      queued.delete(panel.settings.id)
      log('panel removed', { id: panel.settings.id })
      if (!(await ensureWindow())) {
        postNow({ type: 'panelRemoved', id: panel.settings.id })
      }

      return { id: panel.settings.id }
    },

    async channelWrite(params) {
      const panel = panelFor(params, 'panel')
      const data = isRecord(params) ? params.data : undefined
      if (typeof data !== 'string') {
        throw new RpcError('data must be a string, written exactly as a pipe would send it')
      }

      const { format, header } = panel.settings
      const decoder = createDecoder(format, header === undefined ? {} : { header })
      for (const result of [decoder.push(new TextEncoder().encode(data)), decoder.end()]) {
        const problem = ingest(panel, result, false)
        if (problem) {
          throw new RpcError(`malformed data for panel "${panel.settings.id}": ${problem}`)
        }
      }

      return { id: panel.settings.id }
    },

    async sessionEnd() {
      freeze('session_end')
      return { session: id }
    },
  }

  function handlePipe(
    req: IncomingMessage,
    res: ServerResponse,
    panel: Panel,
    ignoreMalformed: boolean,
  ) {
    const panelId = panel.settings.id
    if (frozen) {
      req.resume()
      reply(res, 409, { error: 'the tapet session has ended', session: id })
      return
    }

    const { format, header } = panel.settings
    const decoder = createDecoder(
      format,
      header === undefined ? { ignoreMalformed } : { header, ignoreMalformed },
    )
    let failed = false
    let skipped = 0
    panel.pipes.add(req)
    log('pipe opened', { panel: panelId })

    const fail = (problem: string) => {
      failed = true
      panel.pipes.delete(req)
      const message = `malformed data in a pipe into panel "${panelId}": ${problem}`
      notice(`a pipe into panel "${panelId}" stopped. ${message}`)
      res.setHeader('connection', 'close')
      reply(res, 422, { error: message, session: id }, () => req.destroy())
    }

    const consume = (result: DecodeResult) => {
      skipped += result.skipped
      const problem = ingest(panel, result, ignoreMalformed)
      if (problem) {
        fail(problem)
      }
    }

    req.on('data', (chunk: Buffer) => {
      if (failed) {
        return
      }

      consume(decoder.push(chunk))
    })

    req.on('end', () => {
      if (failed) {
        return
      }

      consume(decoder.end())
      if (failed) {
        return
      }

      panel.pipes.delete(req)
      log('pipe closed', { panel: panelId, skipped })
      reply(res, 200, { panel: panelId, skipped })
    })

    req.on('error', () => {
      panel.pipes.delete(req)
    })
  }

  function handleAttach(res: ServerResponse) {
    if (attachment) {
      reply(res, 409, { error: 'this tapet session is attached to another live connection' })
      return
    }

    const current = randomToken()
    attachment = current
    res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' })
    res.write(`${JSON.stringify({ attachment: current, session: id })}\n`)
    const heartbeat = setInterval(() => res.write('{}\n'), 15_000)
    res.on('close', () => {
      clearInterval(heartbeat)
      if (attachment !== current) {
        return
      }

      attachment = undefined
      freeze('the MCP connection closed')
    })

    if (frozen) {
      unfreeze()
    }

    log('attached')
  }

  async function handleRpc(req: IncomingMessage, res: ServerResponse) {
    if (!attachment || req.headers['x-tapet-attachment'] !== attachment) {
      req.resume()
      reply(res, 409, { error: 'not attached to this session' })
      return
    }

    const request = (await readJson(req)) as RpcRequest
    const method = Object.hasOwn(methods, request.method) ? methods[request.method] : undefined
    if (!method) {
      reply(res, 400, { error: `unknown method "${String(request.method)}"` })
      return
    }

    const respond = (response: RpcResponse) => {
      notices.length = 0
      reply(res, 200, response)
    }

    try {
      if (frozen) {
        throw new RpcError('this session has ended; call window_update to start a new one')
      }

      const result = await method(request.params)
      log('rpc', { method: request.method })
      respond({ ok: true, result, notices: [...notices] })
    } catch (error) {
      if (error instanceof RpcError) {
        log('rpc failed', { method: request.method, error: error.message, issues: error.issues })
        respond({
          ok: false,
          error: error.issues
            ? { message: error.message, issues: error.issues }
            : { message: error.message },
          notices: [...notices],
        })
        return
      }

      log('rpc crashed', { method: request.method, error: String(error) })
      respond({
        ok: false,
        error: { message: `tapet hit an internal error: ${String(error)}` },
        notices: [...notices],
      })
    }
  }

  const server = createServer((req, res) => {
    if (req.headers.origin !== undefined) {
      req.resume()
      reply(res, 403, { error: 'browsers may not talk to tapet' })
      return
    }

    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname.startsWith('/c/')) {
      const panel = channels.get(url.pathname.slice(3))
      if (!panel || (req.method !== 'PUT' && req.method !== 'POST')) {
        req.resume()
        reply(res, 404, {
          error: 'there is no such channel; it belongs to a removed panel or another session',
        })
        return
      }

      handlePipe(req, res, panel, url.searchParams.get('ignoreMalformed') === '1')
      return
    }

    if (!sameSecret(req.headers.authorization, `Bearer ${options.token}`)) {
      req.resume()
      reply(res, 401, { error: 'unauthorized' })
      return
    }

    if (url.pathname === '/attach' && req.method === 'GET') {
      handleAttach(res)
      return
    }

    if (url.pathname === '/rpc' && req.method === 'POST') {
      handleRpc(req, res).catch((error: unknown) => {
        log('rpc request failed', { error: String(error) })
        reply(res, 400, { error: 'the request could not be read' })
      })
      return
    }

    req.resume()
    reply(res, 404, { error: 'not found' })
  })

  // Expires data by time-based retention while no input arrives.
  const trimTimer = setInterval(() => {
    if (frozen) {
      return
    }

    for (const panel of panels.values()) {
      if (typeof panel.settings.retention === 'object' && 'seconds' in panel.settings.retention) {
        queue(panel.settings.id, panel.store.trim(Date.now()))
      }
    }
  }, 1000)

  return {
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => {
          address = `127.0.0.1:${(server.address() as AddressInfo).port}`
          log('session started', { address })
          resolve(`http://${address}`)
        })
      })
    },

    handleMain(message, windowPort) {
      if (message.type === 'windowOpened' && windowPort) {
        openWindow(windowPort)
        return
      }

      if (message.type === 'windowClosed') {
        closeWindow()
        return
      }

      if (message.type === 'screenshot') {
        screenshots.get(message.requestId)?.(message)
        screenshots.delete(message.requestId)
      }
    },

    async close() {
      clearInterval(trimTimer)
      clearTimeout(flushTimer)
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await logWrite
    },
  }
}

function reply(res: ServerResponse, status: number, body: unknown, done?: () => void) {
  if (res.headersSent) {
    res.end(done)
    return
  }

  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body), done)
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.byteLength
      if (size > MAX_RPC_BYTES) {
        reject(new Error('request too large'))
        req.destroy()
        return
      }

      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function randomToken(): string {
  return randomBytes(16).toString('base64url')
}

function sameSecret(actual: string | undefined, expected: string): boolean {
  if (actual === undefined || actual.length !== expected.length) {
    return false
  }

  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
