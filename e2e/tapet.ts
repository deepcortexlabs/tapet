// Starts the real app and connects to it through MCP, the way an agent does.
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { _electron as electron, type ElectronApplication } from '@playwright/test'

const ROOT = join(import.meta.dirname, '..')
const APP = join(ROOT, 'packages', 'app')
const CLI = join(ROOT, 'packages', 'cli', 'src', 'main.ts')

export interface Tapet {
  app: ElectronApplication
  call(name: string, args?: Record<string, unknown>): Promise<CallToolResult>
  // Calls a tool and parses its JSON result.
  json<T = Record<string, unknown>>(name: string, args?: Record<string, unknown>): Promise<T>
  // Closes the MCP connection and opens a new one, the way a harness restarting `tapet mcp` does.
  reconnect(): Promise<void>
  close(): Promise<void>
}

export function text(result: CallToolResult): string {
  const [first] = result.content
  return first?.type === 'text' ? first.text : ''
}

export async function startTapet(environment: NodeJS.ProcessEnv): Promise<Tapet> {
  const env = Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )
  // CI runners have no GPU; WebGL views then need Chromium's software renderer.
  const software = env.CI ? ['--enable-unsafe-swiftshader'] : []
  const app = await electron.launch({ args: [...software, APP], env })
  const connect = async () => {
    const connected = new Client({ name: 'e2e', version: '0' })
    await connected.connect(
      new StdioClientTransport({ command: process.execPath, args: [CLI, 'mcp'], env }),
    )
    return connected
  }
  let client = await connect()
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    (await client.callTool({ name, arguments: args })) as CallToolResult

  return {
    app,
    call,
    json: async (name, args) => JSON.parse(text(await call(name, args))),
    async reconnect() {
      await client.close()
      client = await connect()
    },
    async close() {
      await client.close()
      // tapet keeps running with no windows open, so quit it the way a user would.
      const exited = new Promise((resolve) => app.process().once('exit', resolve))
      await app.evaluate(({ app }) => app.quit())
      await exited
    },
  }
}
