import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { _electron as electron, expect, test } from '@playwright/test'

const ROOT = join(import.meta.dirname, '..')
const APP = join(ROOT, 'packages', 'app')
const CLI = join(ROOT, 'packages', 'cli', 'src', 'main.ts')

function text(result: CallToolResult): string {
  const [first] = result.content
  return first?.type === 'text' ? first.text : ''
}

// A PNG's width and height sit in its header, right after the signature and chunk header.
function pngSize(base64: string) {
  const bytes = Buffer.from(base64, 'base64')
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

test('an agent shows a live log, then ends and reattaches its session', async () => {
  const home = mkdtempSync(join(tmpdir(), 'tapet-e2e-'))
  const env = { ...process.env, TAPET_HOME: home }
  const app = await electron.launch({ args: [APP], env })
  const client = new Client({ name: 'e2e', version: '0' })
  await client.connect(
    new StdioClientTransport({ command: process.execPath, args: [CLI, 'mcp'], env }),
  )
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    (await client.callTool({ name, arguments: args })) as CallToolResult
  const title = () =>
    app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle())

  try {
    const { session } = JSON.parse(
      text(await call('window_update', { name: 'e2e', width: 800, height: 500 })),
    ) as {
      session: string
    }
    const window = await app.firstWindow()

    const created = await call('panel_create', { id: 'log', title: 'Log', preset: 'log' })
    const { pipe } = JSON.parse(text(created)) as { pipe: string }
    // The pipe command reads standard input, like `tail -f app.log | <pipe>` would feed it.
    execSync(pipe, { input: 'alpha\nbeta\ngamma\n' })
    await expect(window.locator('[data-panel=log] .tapet-log-line')).toHaveCount(3)

    const shot = await call('window_screenshot')
    const [image] = shot.content
    expect(image?.type).toBe('image')
    const expected = await app.evaluate(({ BrowserWindow, screen }) => {
      const found = BrowserWindow.getAllWindows()[0]
      const [width = 0, height = 0] = found?.getContentSize() ?? []
      const { scaleFactor } = screen.getDisplayMatching(
        found?.getBounds() ?? { x: 0, y: 0, width: 1, height: 1 },
      )
      return { width: Math.round(width * scaleFactor), height: Math.round(height * scaleFactor) }
    })
    expect(pngSize(image?.type === 'image' ? image.data : '')).toEqual(expected)

    await window.locator('.tapet-log-search').fill('bet')
    await expect(window.locator('[data-panel=log] .tapet-log-line')).toHaveText(['beta'])

    await call('panel_update', { id: 'log', css: '.tapet-title { display: none }' })
    await expect(window.locator('[data-panel=log] .tapet-title')).toBeHidden()

    await call('session_end')
    await expect.poll(title).toBe('e2e (ended)')
    expect(() => execSync(pipe, { input: 'late\n', stdio: 'pipe' })).toThrow()

    expect(JSON.parse(text(await call('session_attach', { session })))).toEqual({ session })
    await expect.poll(title).toBe('e2e')
  } finally {
    await client.close()
    // tapet keeps running with no windows open, so quit it the way a user would.
    const exited = new Promise((resolve) => app.process().once('exit', resolve))
    await app.evaluate(({ app }) => app.quit())
    await exited
  }
})
