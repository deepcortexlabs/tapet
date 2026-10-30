import { request } from 'node:http'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import type {
  RpcMethod,
  RpcResponse,
  SessionToMain,
  SessionToWindow,
  WindowToSession,
} from '@tapet/protocol'
import {
  createSession,
  type MainLink,
  type Session,
  type WindowPort,
} from '../src/session/session.ts'

const AUTH = { authorization: 'Bearer secret' }
const running: Session[] = []

afterEach(async () => {
  await Promise.all(running.splice(0).map((session) => session.close()))
})

// A window that renders instantly and answers geometry requests.
function fakeWindow() {
  const received: SessionToWindow[] = []
  let listener: ((message: WindowToSession) => void) | undefined
  const respond = (message: SessionToWindow) => {
    if (message.type === 'snapshot') {
      for (const panel of message.panels) {
        listener?.({ type: 'rendered', panel: panel.settings.id })
      }
    }

    if (message.type === 'panelAdded') {
      listener?.({ type: 'rendered', panel: message.panel.settings.id })
    }

    if (message.type === 'panelUpdated') {
      listener?.({ type: 'rendered', panel: message.settings.id })
    }

    if (message.type === 'geometry') {
      const panels = [
        { id: 'log', x: 10, y: 20, width: 300, height: 200, overflow: false, zeroSize: false },
      ]
      listener?.({
        type: 'geometry',
        requestId: message.requestId,
        geometry: { window: { width: 900, height: 600 }, panels },
      })
    }
  }
  const port: WindowPort = {
    post(message) {
      received.push(message)
      queueMicrotask(() => respond(message))
    },
    onMessage(next) {
      listener = next
    },
  }

  // Values the window received for a panel, through change sets.
  const added = (panelId: string) =>
    received.flatMap((message) =>
      message.type === 'changes'
        ? (message.panels[panelId] ?? []).flatMap((change) =>
            change.added.map((entry) => entry.value),
          )
        : [],
    )

  return { port, received, added }
}

async function startSession() {
  const home = await mkdtemp(join(tmpdir(), 'tapet-session-'))
  const window = fakeWindow()
  const sent: SessionToMain[] = []
  let opened = false
  const main: MainLink = {
    send(message) {
      sent.push(message)
      if (message.type === 'showWindow' && !opened) {
        opened = true
        queueMicrotask(() => session.handleMain({ type: 'windowOpened' }, window.port))
      }

      if (message.type === 'screenshot') {
        const png = new Uint8Array([137, 80, 78, 71])
        queueMicrotask(() =>
          session.handleMain({ type: 'screenshot', requestId: message.requestId, png }),
        )
      }
    },
  }
  const session = createSession({
    id: 's_test',
    token: 'secret',
    logPath: join(home, 's_test.log'),
    main,
    renderTimeoutMs: 500,
  })
  running.push(session)
  const url = await session.listen()
  return { url, sent, window }
}

async function attach(url: string) {
  const controller = new AbortController()
  const response = await fetch(`${url}/attach`, { headers: AUTH, signal: controller.signal })
  if (response.status !== 200 || !response.body) {
    return { status: response.status, attachment: '', detach: () => undefined }
  }

  const { value } = await response.body.getReader().read()
  const [first = '{}'] = new TextDecoder().decode(value).split('\n')
  const { attachment } = JSON.parse(first) as { attachment: string }
  return { status: 200, attachment, detach: () => controller.abort() }
}

async function rpc(url: string, attachment: string, method: RpcMethod, params?: unknown) {
  const response = await fetch(`${url}/rpc`, {
    method: 'POST',
    headers: { ...AUTH, 'x-tapet-attachment': attachment, 'content-type': 'application/json' },
    body: JSON.stringify({ method, params }),
  })
  return (await response.json()) as RpcResponse
}

async function pipe(channel: string, text: string, query = '') {
  const response = await fetch(`http://${channel}${query}`, { method: 'PUT', body: text })
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

async function until(check: () => boolean) {
  const deadline = Date.now() + 2000
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error('timed out')
    }

    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

async function attachedWithLog(format = 'lines') {
  const started = await startSession()
  const { attachment } = await attach(started.url)
  await rpc(started.url, attachment, 'windowUpdate', { name: 'logs' })
  const preset =
    format === 'lines' ? { preset: 'log' } : { format, update: 'append', view: 'custom' }
  const created = await rpc(started.url, attachment, 'panelCreate', {
    id: 'log',
    title: 'Log',
    ...preset,
  })
  const { channel } = (created as { result: { channel: string } }).result
  return { ...started, attachment, channel }
}

it('allows one live connection at a time and ends the session when it goes away', async () => {
  const { url, sent } = await startSession()
  const first = await attach(url)
  expect((await attach(url)).status).toBe(409)

  first.detach()
  await until(() => sent.some((message) => message.type === 'frozen' && message.frozen))
  expect((await attach(url)).status).toBe(200)
  expect(sent.at(-1)).toEqual({ type: 'frozen', frozen: false })
})

it('refuses RPC from clients that are not attached', async () => {
  const { url } = await startSession()
  const response = await fetch(`${url}/rpc`, {
    method: 'POST',
    headers: AUTH,
    body: '{"method":"windowGet"}',
  })
  expect(response.status).toBe(409)
})

it('refuses requests from browsers', async () => {
  const { url } = await startSession()
  const response = await fetch(`${url}/attach`, {
    headers: { ...AUTH, origin: 'https://example.com' },
  })
  expect(response.status).toBe(403)
})

it('reports invalid panel settings with their issues', async () => {
  const { url } = await startSession()
  const { attachment } = await attach(url)
  await rpc(url, attachment, 'windowUpdate', { name: 'logs' })
  const response = await rpc(url, attachment, 'panelCreate', {
    id: 'log',
    title: 'Log',
    preset: 'log',
    format: 'ndjson',
  })
  expect(response).toMatchObject({
    ok: false,
    error: { message: 'invalid panel settings', issues: [{ path: 'view' }] },
  })
})

it('streams piped lines to the window', async () => {
  const { channel, window } = await attachedWithLog()
  const { status } = await pipe(channel, 'first\nsecond\n')
  expect(status).toBe(200)
  await until(() => window.added('log').length === 2)
  expect(window.added('log')).toEqual(['first', 'second'])
})

it('stops a pipe at malformed data and reports it with the next tool result', async () => {
  const { url, attachment, channel } = await attachedWithLog('ndjson')
  const { status, body } = await pipe(channel, '{"a":1}\nnot json\n')
  expect(status).toBe(422)
  expect(body.error).toContain('line 2')

  const next = await rpc(url, attachment, 'windowGet')
  expect(next.notices).toEqual([expect.stringContaining('stopped')])
})

it('skips malformed data when the pipe asks to ignore it', async () => {
  const { channel } = await attachedWithLog('ndjson')
  const { status, body } = await pipe(channel, '{"a":1}\nnot json\n{"b":2}\n', '?ignoreMalformed=1')
  expect(status).toBe(200)
  expect(body.skipped).toBe(1)
})

it('writes agent data exactly like a pipe', async () => {
  const { url, attachment, window } = await attachedWithLog()
  expect((await rpc(url, attachment, 'channelWrite', { panel: 'log', data: 'one\ntwo' })).ok).toBe(
    true,
  )
  await until(() => window.added('log').length === 2)
})

it('keeps data when settings change, and rejects fixed settings', async () => {
  const { url, attachment, channel, window } = await attachedWithLog()
  await pipe(channel, 'a\n')
  expect((await rpc(url, attachment, 'panelUpdate', { id: 'log', title: 'Renamed' })).ok).toBe(true)
  expect(window.received.some((message) => message.type === 'panelUpdated')).toBe(true)

  const rejected = await rpc(url, attachment, 'panelUpdate', { id: 'log', format: 'csv' })
  expect(rejected).toMatchObject({ ok: false, error: { issues: [{ path: 'format' }] } })
})

it('cuts open pipes and refuses new ones once the session ends', async () => {
  const { url, attachment, channel } = await attachedWithLog()
  const open = request(`http://${channel}`, { method: 'PUT' })
  const cut = new Promise<string>((resolve) => {
    open.on('error', (error) => resolve(error.message))
    open.on('response', (response) => resolve(`status ${response.statusCode}`))
  })
  open.write('streaming\n')
  await new Promise((resolve) => setTimeout(resolve, 50))

  expect((await rpc(url, attachment, 'sessionEnd')).ok).toBe(true)
  expect(await cut).not.toBe('status 200')
  expect((await pipe(channel, 'late\n')).status).toBe(409)
})

it('screenshots a panel by its place in the window', async () => {
  const { url, attachment, sent } = await attachedWithLog()
  const response = await rpc(url, attachment, 'windowScreenshot', { panel: 'log' })
  expect(response).toMatchObject({
    ok: true,
    result: { png: Buffer.from([137, 80, 78, 71]).toString('base64') },
  })
  expect(sent).toContainEqual({
    type: 'screenshot',
    requestId: expect.any(Number),
    rect: { x: 10, y: 20, width: 300, height: 200 },
  })
})
