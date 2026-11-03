import { execSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { startTapet, text } from './tapet.ts'

// A PNG's width and height sit in its header, right after the signature and chunk header.
function pngSize(base64: string) {
  const bytes = Buffer.from(base64, 'base64')
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

// An OpenAI-compatible server that answers every chat request the same way.
async function fakeModelServer(): Promise<Server> {
  const server = createServer((request, response) => {
    request.resume()
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          id: 'chatcmpl-e2e',
          object: 'chat.completion',
          created: 1_700_000_000,
          model: 'fake',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'Saw **3 lines**' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
        }),
      )
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return server
}

test('an agent shows a live log with a smart summary, then ends and reattaches its session', async () => {
  const home = mkdtempSync(join(tmpdir(), 'tapet-e2e-'))
  const model = await fakeModelServer()
  const configPath = join(home, 'config.json')
  writeFileSync(
    configPath,
    JSON.stringify({
      providers: {
        openai: { base_url: `http://127.0.0.1:${(model.address() as AddressInfo).port}/v1` },
      },
      models: ['openai/fake'],
    }),
  )
  const env = { ...process.env, TAPET_HOME: home, TAPET_CONFIG: configPath }
  const tapet = await startTapet(env)
  const { app, call } = tapet

  try {
    expect(JSON.parse(text(await call('models_get')))).toEqual({
      models: ['openai/fake'],
      default_model: 'openai/fake',
    })
    const { session } = JSON.parse(
      text(await call('window_update', { name: 'e2e', width: 800, height: 500 })),
    ) as {
      session: string
    }
    const window = await app.firstWindow()

    const created = await call('panel_create', {
      id: 'log',
      title: 'Log',
      preset: 'log',
      smart: { prompt: 'Count the lines', every: { items: 3 } },
    })
    const { pipe } = JSON.parse(text(created)) as { pipe: string }
    // The pipe command reads standard input, like `tail -f app.log | <pipe>` would feed it.
    execSync(pipe, { input: 'alpha\nbeta\ngamma\n' })
    const panel = window.locator('[data-panel=log]')
    await expect(panel.locator('.tapet-log-line')).toHaveCount(3)
    await expect(panel.locator('.tapet-smart-output strong')).toHaveText('3 lines')
    await expect(panel.locator('.tapet-dot')).toHaveAttribute('data-state', 'idle')
    expect(JSON.parse(text(await call('smart_read', { panel: 'log' })))).toMatchObject({
      outputs: [{ text: 'Saw **3 lines**', model: 'openai/fake', tokens: 16 }],
    })

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
    await expect(panel.locator('.tapet-log-line')).toHaveText(['beta'])

    await call('panel_update', { id: 'log', css: '.tapet-title { display: none }' })
    await expect(panel.locator('.tapet-title')).toBeHidden()

    await call('session_end')
    await expect(panel.locator('.tapet-dot')).toHaveAttribute('data-state', 'ended')
    await expect(window.locator('.tapet-session-status')).toContainText('Session ended at')
    expect(() => execSync(pipe, { input: 'late\n', stdio: 'pipe' })).toThrow()

    expect(JSON.parse(text(await call('session_attach', { session })))).toEqual({ session })
    await expect(panel.locator('.tapet-dot')).toHaveAttribute('data-state', 'idle')
    await expect(window.locator('.tapet-session-status')).toHaveCount(0)
  } finally {
    await tapet.close()
    model.close()
  }
})
