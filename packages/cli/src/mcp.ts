// `tapet mcp`: the MCP server a harness starts. It creates or attaches to a session on demand and
// forwards window and panel calls to that session's background process.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { panelChangesSchema, panelCreateSchema, windowUpdateSchema } from '@tapet/core'
import {
  TAPET_VERSION,
  type RpcMethod,
  type RpcResponse,
  type SessionAddress,
} from '@tapet/protocol'
import { requestSession } from './app.ts'
import { TapetError, commandLine, selfCommand } from './paths.ts'
import { attachSession, type AttachedSession } from './session-client.ts'

// Where sessions come from: the running app, or an in-process stand-in in tests.
export interface Backend {
  createSession(): Promise<SessionAddress>
  attachSession(id: string): Promise<SessionAddress>
}

const appBackend: Backend = {
  createSession: () => requestSession({ type: 'createSession' }),
  attachSession: (session) => requestSession({ type: 'attachSession', session }),
}

export const DOC_TOPICS = [
  'overview',
  'panels',
  'formats',
  'views',
  'css',
  'pipes',
  'sessions',
  'troubleshooting',
] as const

const INSTRUCTIONS = `tapet is a window you direct to show things to your user. Data doesn't pass through you: you run commands in your own shell and pipe their output straight into tapet panels.
- Record your tapet session id (window_update returns it). session_attach reconnects to it later.
- Resuming is your job: keep your own record of your setup. window_get returns the current one.
- Pipes like \`tail -f … | <pipe>\` never exit, so run them in a way that doesn't block you.
- Memory is yours to manage: set retention on panels that receive endless data.
Call docs_get for details.`

interface Tool {
  name: string
  description: string
  schema: z.ZodType
  run(args: Record<string, unknown>): Promise<CallToolResult>
}

const noArguments = z.strictObject({})

export function createTapetServer(backend: Backend = appBackend): Server {
  let session: AttachedSession | undefined

  function requireSession(): AttachedSession {
    if (session?.isOpen()) {
      return session
    }

    if (session) {
      throw new TapetError(
        'your tapet session is gone (the app quit or the session ended). Call window_update with a name to start a new one, or session_attach to reconnect to an ended session.',
      )
    }

    throw new TapetError(
      'there is no tapet window yet. Call window_update with a name to open one, or session_attach to reconnect to an earlier session.',
    )
  }

  async function forward(method: RpcMethod, params?: unknown): Promise<CallToolResult> {
    const current = requireSession()
    return fromRpc(await current.rpc(method, params), current.id)
  }

  const tools: Tool[] = [
    {
      name: 'window_update',
      description:
        'Opens your tapet window, or changes it. The first call must include name (the window title). Fields you send replace those fields: name, width, height, x, y, always_on_top, and css (one global stylesheet, e.g. for the layout). Returns your tapet session id; record it so you can reconnect with session_attach.',
      schema: windowUpdateSchema,
      async run(args) {
        if (!session?.isOpen()) {
          if (typeof args.name !== 'string' || args.name.trim() === '') {
            throw new TapetError('name is required on the first window_update: the window title')
          }

          session = await attachSession(await backend.createSession())
        }

        return fromRpc(await session.rpc('windowUpdate', args), session.id)
      },
    },
    {
      name: 'window_get',
      description:
        "Returns your window's current setup: window settings, the global CSS and every panel's settings. No data.",
      schema: noArguments,
      run: () => forward('windowGet'),
    },
    {
      name: 'window_focus',
      description: 'Brings your window to the front, reopening it if the user closed it.',
      schema: noArguments,
      run: () => forward('windowFocus'),
    },
    {
      name: 'window_screenshot',
      description:
        'Returns a PNG of what your window shows right now, in full screen resolution: the whole window, or one panel.',
      schema: z.strictObject({ panel: z.string().optional() }),
      async run(args) {
        const current = requireSession()
        const response = await current.rpc('windowScreenshot', args)
        if (!response.ok) {
          return fromRpc(response, current.id)
        }

        const { png } = response.result as { png: string }
        const content: CallToolResult['content'] = [
          { type: 'image', data: png, mimeType: 'image/png' },
        ]
        if (response.notices.length > 0) {
          content.push({
            type: 'text',
            text: JSON.stringify({ notices: response.notices }, null, 2),
          })
        }

        return { content }
      },
    },
    {
      name: 'window_inspect',
      description:
        "Returns computed geometry: each panel's box in the window, and whether it overflows or has zero size. A cheap way to check your CSS without a screenshot.",
      schema: noArguments,
      run: () => forward('windowInspect'),
    },
    {
      name: 'panel_create',
      description:
        'Creates a panel. Pick a preset (log, timeseries, table, graph, document, gauge, map) and override any setting, or set format, update and view yourself. id is a simple name (letters, digits, - and _), also used in CSS as [data-panel=<id>]; title is required. Returns pipe: run `<your command> | <pipe>` in your shell to stream data into the panel. format, header, update and key are fixed once created. Views available in this version: log. See docs_get("panels").',
      schema: panelCreateSchema,
      async run(args) {
        const current = requireSession()
        const response = await current.rpc('panelCreate', args)
        return fromRpc(response, current.id, (result) => {
          const { channel } = result as { channel: string }
          return { pipe: commandLine([...selfCommand(), '-c', channel]) }
        })
      },
    },
    {
      name: 'panel_update',
      description:
        "Changes a panel's settings. Fields you send replace those fields: title, retention, view, follow, mapping, css. The panel's data and pipe stay untouched. format, header, update and key are fixed: remove the panel and create a new one to change them.",
      schema: z.strictObject({ id: z.string(), ...panelChangesSchema.shape }),
      run: (args) => forward('panelUpdate', args),
    },
    {
      name: 'panel_remove',
      description: 'Removes a panel and closes its pipes.',
      schema: z.strictObject({ id: z.string() }),
      run: (args) => forward('panelRemove', args),
    },
    {
      name: 'channel_write',
      description:
        "Sends data you already have into a panel, processed exactly like a pipe: the panel's format splits it into items. For large or streaming data, use the panel's pipe command instead.",
      schema: z.strictObject({ panel: z.string(), data: z.string() }),
      run: (args) => forward('channelWrite', args),
    },
    {
      name: 'session_attach',
      description:
        'Reconnects to an earlier tapet session by its id, whether it is live or ended. Fails if another live connection holds it. After a harness restart, use this with the id you recorded.',
      schema: z.strictObject({ session: z.string() }),
      async run(args) {
        if (typeof args.session !== 'string') {
          throw new TapetError('session must be a tapet session id')
        }

        const address = await backend.attachSession(args.session)
        session?.detach()
        session = await attachSession(address)
        return textResult({ session: session.id })
      },
    },
    {
      name: 'session_end',
      description:
        'Ends your tapet session: its panels stay visible but stop updating, and its pipes are closed. Your next window_update starts a new session.',
      schema: noArguments,
      async run() {
        const current = requireSession()
        const result = fromRpc(await current.rpc('sessionEnd'), current.id)
        current.detach()
        session = undefined
        return result
      },
    },
    {
      name: 'docs_get',
      description: `Usage docs by topic: ${DOC_TOPICS.join(', ')}.`,
      schema: z.strictObject({ topic: z.enum(DOC_TOPICS) }),
      async run(args) {
        const topic = DOC_TOPICS.find((name) => name === args.topic)
        if (!topic) {
          throw new TapetError(`topic must be one of: ${DOC_TOPICS.join(', ')}`)
        }

        return textResult(
          await readFile(join(import.meta.dirname, '..', 'docs', `${topic}.md`), 'utf8'),
        )
      },
    },
  ]

  const server = new Server(
    { name: 'tapet', version: TAPET_VERSION },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  )

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: toolSchema(tool.schema),
    })),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = tools.find((candidate) => candidate.name === request.params.name)
    if (!tool) {
      return textResult(`there is no tool "${request.params.name}"`, true)
    }

    try {
      return await tool.run(request.params.arguments ?? {})
    } catch (error) {
      if (error instanceof TapetError) {
        return textResult(error.message, true)
      }

      return textResult(`tapet hit an internal error: ${String(error)}`, true)
    }
  })

  return server
}

export async function runMcp(): Promise<void> {
  const server = createTapetServer()
  // The attached session connection would keep this process alive after the harness is gone.
  server.onclose = () => process.exit(0)
  process.stdin.on('end', () => process.exit(0))
  await server.connect(new StdioServerTransport())
}

function toolSchema(schema: z.ZodType): { type: 'object' } {
  return z.toJSONSchema(schema, {
    io: 'input',
    // zod adds JavaScript's safe-integer limits to every whole-number field: noise in every agent's context.
    override: ({ jsonSchema }) => {
      if (jsonSchema.maximum === Number.MAX_SAFE_INTEGER) {
        delete jsonSchema.maximum
      }

      if (jsonSchema.minimum === Number.MIN_SAFE_INTEGER) {
        delete jsonSchema.minimum
      }
    },
  }) as { type: 'object' }
}

function textResult(value: unknown, isError = false): CallToolResult {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  if (isError) {
    return { content: [{ type: 'text', text }], isError: true }
  }

  return { content: [{ type: 'text', text }] }
}

function fromRpc(
  response: RpcResponse,
  sessionId: string,
  shape: (result: unknown) => unknown = (result) => result,
): CallToolResult {
  if (response.ok) {
    const result = shape(response.result) as Record<string, unknown>
    return textResult(
      response.notices.length > 0 ? { ...result, notices: response.notices } : result,
    )
  }

  const lines = [
    response.error.message,
    ...(response.error.issues ?? []).map(
      (issue) => `- ${issue.path || '(input)'}: ${issue.message}`,
    ),
  ]
  if (response.notices.length > 0) {
    lines.push('', 'Also since your last call:', ...response.notices.map((notice) => `- ${notice}`))
  }

  lines.push('', `Session log: ${commandLine([...selfCommand(), 'logs', '--session', sessionId])}`)
  return textResult(lines.join('\n'), true)
}
