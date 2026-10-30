// Entry of a session's background process (an Electron utility process forked by main).
import type { MessagePortMain } from 'electron'
import {
  sessionLogPath,
  type MainToSession,
  type SessionToMain,
  type WindowToSession,
} from '@tapet/protocol'
import { createSession, type Session, type WindowPort } from './session.ts'

const parentPort = process.parentPort
let session: Session | undefined

function send(message: SessionToMain) {
  parentPort.postMessage(message)
}

function wrap(port: MessagePortMain): WindowPort {
  port.start()
  return {
    post: (message) => port.postMessage(message),
    onMessage: (listener) => {
      port.on('message', (event) => listener(event.data as WindowToSession))
    },
  }
}

async function handle(message: MainToSession, port: MessagePortMain | undefined) {
  if (message.type === 'init') {
    session = createSession({
      id: message.id,
      token: message.token,
      logPath: sessionLogPath(message.id, message.home),
      main: { send },
    })
    send({ type: 'ready', url: await session.listen() })
    return
  }

  if (message.type === 'discard') {
    await session?.close()
    process.exit(0)
  }

  session?.handleMain(message, port && wrap(port))
}

parentPort.on('message', (event) => {
  handle(event.data as MainToSession, event.ports[0]).catch((error: unknown) => {
    console.error('tapet session:', error)
  })
})
