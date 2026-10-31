// An in-process stand-in for the app: real session processes' logic, with a window that renders
// instantly and a screenshot of four bytes.
import { randomBytes } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MockLanguageModelV4 } from 'ai/test'
import { createSession, type Session, type WindowPort } from '@tapet/app/session'
import type { SessionAddress, SessionToWindow, WindowToSession } from '@tapet/protocol'
import type { Backend } from '../src/mcp.ts'
import { TapetError } from '../src/paths.ts'

export const FAKE_PNG = new Uint8Array([137, 80, 78, 71])

export const FAKE_MODEL = new MockLanguageModelV4({
  doGenerate: async () => ({
    content: [{ type: 'text', text: '**summary**' }],
    finishReason: { unified: 'stop', raw: undefined },
    usage: {
      inputTokens: { total: 4, noCache: 4, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 2, text: 2, reasoning: undefined },
    },
    warnings: [],
  }),
})

function renderingWindow(): WindowPort {
  let listener: ((message: WindowToSession) => void) | undefined
  const respond = (message: SessionToWindow) => {
    const ids =
      message.type === 'snapshot'
        ? message.panels.map((panel) => panel.settings.id)
        : message.type === 'panelAdded'
          ? [message.panel.settings.id]
          : message.type === 'panelUpdated'
            ? [message.settings.id]
            : []
    for (const panel of ids) {
      listener?.({ type: 'rendered', panel })
    }
  }

  return {
    post: (message) => queueMicrotask(() => respond(message)),
    onMessage: (next) => {
      listener = next
    },
  }
}

export async function fakeApp() {
  const home = await mkdtemp(join(tmpdir(), 'tapet-cli-'))
  const sessions = new Map<string, { session: Session; address: SessionAddress }>()

  async function start(): Promise<SessionAddress> {
    const id = `s_${randomBytes(4).toString('hex')}`
    const token = randomBytes(8).toString('hex')
    let opened = false
    const session: Session = createSession({
      id,
      token,
      logPath: join(home, 'logs', `${id}.log`),
      renderTimeoutMs: 500,
      modelFor: () => FAKE_MODEL,
      main: {
        send(message) {
          if (message.type === 'showWindow' && !opened) {
            opened = true
            queueMicrotask(() => session.handleMain({ type: 'windowOpened' }, renderingWindow()))
          }

          if (message.type === 'capCheck') {
            const reply = {
              type: 'cap',
              requestId: message.requestId,
              allowed: true,
              used: 0,
              cap: 100,
            } as const
            queueMicrotask(() => session.handleMain(reply))
          }

          if (message.type === 'screenshot') {
            const reply = {
              type: 'screenshot',
              requestId: message.requestId,
              png: FAKE_PNG,
            } as const
            queueMicrotask(() => session.handleMain(reply))
          }
        },
      },
    })
    const address = { id, token, url: await session.listen() }
    sessions.set(id, { session, address })
    return address
  }

  const backend: Backend = {
    createSession: start,
    async attachSession(id) {
      const found = sessions.get(id)
      if (!found) {
        throw new TapetError(`there is no tapet session "${id}"`)
      }

      return found.address
    },
  }

  return {
    backend,
    home,
    start,
    close: () => Promise.all([...sessions.values()].map(({ session }) => session.close())),
  }
}
