// Talks to the app's main process over the control socket, launching the app when it isn't running.
import { spawn } from 'node:child_process'
import { connect, type Socket } from 'node:net'
import {
  PROTOCOL_VERSION,
  controlSocketPath,
  type ControlRequest,
  type ControlResponse,
  type SessionAddress,
} from '@tapet/protocol'
import { TapetError, appDir, commandLine, findElectron, selfCommand } from './paths.ts'

type Request = { type: 'createSession' } | { type: 'attachSession'; session: string }

export async function requestSession(request: Request): Promise<SessionAddress> {
  const socket = await connectOrLaunch()
  try {
    const lines = readLines(socket)
    const hello = await exchange(socket, lines, {
      id: 1,
      type: 'hello',
      protocol: PROTOCOL_VERSION,
    })
    if (!hello.ok || hello.protocol !== PROTOCOL_VERSION) {
      throw new TapetError(
        `a different version of tapet is already running (it speaks protocol ${hello.ok ? hello.protocol : '?'}, this tapet speaks ${PROTOCOL_VERSION}); quit tapet (Cmd-Q) and retry`,
      )
    }

    const response = await exchange(socket, lines, { id: 2, ...request })
    if (!response.ok) {
      throw new TapetError(response.error)
    }

    if (!response.session) {
      throw new TapetError('tapet did not return a session')
    }

    return response.session
  } finally {
    socket.end()
  }
}

async function connectOrLaunch(): Promise<Socket> {
  const running = await tryConnect()
  if (running) {
    return running
  }

  launchApp()
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    const socket = await tryConnect()
    if (socket) {
      return socket
    }
  }

  throw new TapetError('tapet did not start within 10 seconds')
}

function tryConnect(): Promise<Socket | undefined> {
  return new Promise((resolve) => {
    const socket = connect(controlSocketPath())
    socket.once('connect', () => resolve(socket))
    socket.once('error', () => resolve(undefined))
  })
}

function launchApp() {
  const electron = findElectron()
  if (!electron) {
    throw new TapetError(
      `tapet isn't set up yet. Run this, then retry: ${commandLine([...selfCommand(), 'setup'])}`,
    )
  }

  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  spawn(electron, [appDir()], { detached: true, stdio: 'ignore', env }).unref()
}

// Yields the socket's lines, one JSON object each.
function readLines(socket: Socket): AsyncIterator<string> {
  let buffer = ''
  const ready: string[] = []
  let waiting: ((result: IteratorResult<string>) => void) | undefined
  let ended = false
  socket.setEncoding('utf8')
  socket.on('data', (chunk: string) => {
    buffer += chunk
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    ready.push(...lines.filter((line) => line.trim() !== ''))
    deliver()
  })
  socket.on('close', () => {
    ended = true
    deliver()
  })

  function deliver() {
    if (!waiting) {
      return
    }

    const line = ready.shift()
    if (line !== undefined) {
      const resolve = waiting
      waiting = undefined
      resolve({ value: line, done: false })
      return
    }

    if (ended) {
      const resolve = waiting
      waiting = undefined
      resolve({ value: undefined, done: true })
    }
  }

  return {
    next() {
      return new Promise((resolve) => {
        waiting = resolve
        deliver()
      })
    },
  }
}

async function exchange(
  socket: Socket,
  lines: AsyncIterator<string>,
  request: ControlRequest,
): Promise<ControlResponse> {
  socket.write(`${JSON.stringify(request)}\n`)
  const { value, done } = await lines.next()
  if (done) {
    throw new TapetError('tapet closed the connection')
  }

  return JSON.parse(value) as ControlResponse
}
