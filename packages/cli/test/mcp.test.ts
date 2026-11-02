import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, expect, it } from 'vitest'
import type { Config } from '@tapet/protocol'
import { createTapetServer } from '../src/mcp.ts'
import { FAKE_PNG, fakeApp } from './fake-app.ts'

const apps: Array<Awaited<ReturnType<typeof fakeApp>>> = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

const CONFIG: Config = {
  providers: { openai: { api_key: 'sk-secret' } },
  models: ['openai/fake'],
  default_model: 'openai/fake',
  smart_input_tokens: 50_000,
  window_focus: 'never',
  ended_panels: 'keep',
  daily_token_cap: 2_000_000,
  app_presence: 'dock',
}

async function connect(issues: string[] = []) {
  const app = await fakeApp()
  apps.push(app)
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await createTapetServer({
    backend: app.backend,
    config: async () => ({ config: CONFIG, issues }),
  }).connect(serverSide)
  const client = new Client({ name: 'test', version: '0' })
  await client.connect(clientSide)
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    (await client.callTool({ name, arguments: args })) as CallToolResult
  return { client, call }
}

function text(result: CallToolResult): string {
  const [first] = result.content
  return first?.type === 'text' ? first.text : ''
}

it('lists every tool with a strict JSON schema, and short instructions', async () => {
  const { client } = await connect()
  const { tools } = await client.listTools()
  expect(tools.map((tool) => tool.name)).toEqual([
    'window_update',
    'window_get',
    'window_focus',
    'window_screenshot',
    'window_inspect',
    'panel_create',
    'panel_update',
    'panel_remove',
    'channel_write',
    'smart_run',
    'smart_read',
    'session_attach',
    'session_end',
    'models_get',
    'docs_get',
  ])
  expect(tools.find((tool) => tool.name === 'panel_create')?.inputSchema).toMatchObject({
    additionalProperties: false,
  })
  expect(client.getInstructions()).toContain('Record your tapet session id')
  expect(JSON.stringify(tools)).not.toContain(String(Number.MAX_SAFE_INTEGER))
})

it('needs a name to open the window, and returns the session id', async () => {
  const { call } = await connect()
  const nameless = await call('window_update', { width: 800 })
  expect(nameless.isError).toBe(true)
  expect(text(nameless)).toContain('name is required')

  const opened = await call('window_update', { name: 'logs' })
  expect(JSON.parse(text(opened))).toEqual({ session: expect.stringMatching(/^s_/) })
})

it('asks for a window before other calls', async () => {
  const { call } = await connect()
  const result = await call('panel_create', { id: 'log', title: 'Log', preset: 'log' })
  expect(result.isError).toBe(true)
  expect(text(result)).toContain('there is no tapet window yet')
})

it('returns a ready-to-run pipe command for a new panel', async () => {
  const { call } = await connect()
  await call('window_update', { name: 'logs' })
  const result = await call('panel_create', { id: 'log', title: 'Log', preset: 'log' })
  expect(JSON.parse(text(result)).pipe).toMatch(/pipe-main\.ts"? -c 127\.0\.0\.1:\d+\/c\//)
})

it('explains invalid settings with their issues and the session log', async () => {
  const { call } = await connect()
  await call('window_update', { name: 'logs' })
  const result = await call('panel_create', {
    id: 'log',
    title: 'Log',
    preset: 'log',
    format: 'csv',
  })
  expect(result.isError).toBe(true)
  expect(text(result)).toContain('- view: the log view needs format lines')
  expect(text(result)).toContain('Session log:')
})

it('returns screenshots as images', async () => {
  const { call } = await connect()
  await call('window_update', { name: 'logs' })
  const result = await call('window_screenshot')
  expect(result.content[0]).toEqual({
    type: 'image',
    mimeType: 'image/png',
    data: Buffer.from(FAKE_PNG).toString('base64'),
  })
})

it('ends a session and reattaches to it by id', async () => {
  const { call } = await connect()
  const { session } = JSON.parse(text(await call('window_update', { name: 'logs' }))) as {
    session: string
  }
  expect((await call('session_end')).isError).toBeUndefined()
  expect((await call('window_get')).isError).toBe(true)

  expect(JSON.parse(text(await call('session_attach', { session })))).toEqual({ session })
  expect(JSON.parse(text(await call('window_get')))).toMatchObject({
    session,
    window: { name: 'logs' },
  })
})

it('serves usage docs by topic', async () => {
  const { call } = await connect()
  expect(text(await call('docs_get', { topic: 'pipes' }))).toContain('# Pipes')
})

it('lists the configured models without their keys', async () => {
  const { call } = await connect()
  const listed = text(await call('models_get'))
  expect(JSON.parse(listed)).toEqual({ models: ['openai/fake'], default_model: 'openai/fake' })
  expect(listed).not.toContain('sk-secret')
})

it('runs a smart panel and reads its outputs', async () => {
  const { call } = await connect()
  await call('window_update', { name: 'logs' })
  await call('panel_create', {
    id: 'log',
    title: 'Log',
    preset: 'log',
    smart: { prompt: 'Summarize' },
  })
  expect(JSON.parse(text(await call('smart_run', { panel: 'log' })))).toMatchObject({
    text: '**summary**',
    tokens: 6,
  })
  expect(JSON.parse(text(await call('smart_read', { panel: 'log', last: 5 })))).toMatchObject({
    outputs: [{ text: '**summary**' }],
  })
})

it('reports config problems with the next tool result', async () => {
  const { call } = await connect(['~/.config/tapet/config.json: unknown setting "colour"'])
  const opened = JSON.parse(text(await call('window_update', { name: 'logs' })))
  expect(opened.notices).toEqual([
    'tapet config: ~/.config/tapet/config.json: unknown setting "colour"',
  ])
})
