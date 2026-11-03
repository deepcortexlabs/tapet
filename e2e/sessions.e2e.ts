import { execSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { startTapet, text } from './tapet.ts'

test('a closed MCP connection only detaches the session: data keeps flowing until an agent returns', async () => {
  const home = mkdtempSync(join(tmpdir(), 'tapet-e2e-'))
  // Closing a window no agent holds would ask Discard or Keep; this answer is remembered.
  writeFileSync(join(home, 'preferences.json'), JSON.stringify({ frozenWindowClose: 'discard' }))
  const tapet = await startTapet({
    ...process.env,
    TAPET_HOME: home,
    TAPET_CONFIG: join(home, 'none'),
  })
  try {
    const { session } = await tapet.json<{ session: string }>('window_update', { name: 'feed' })
    const page = await tapet.app.firstWindow()
    const { pipe } = await tapet.json<{ pipe: string }>('panel_create', {
      id: 'log',
      title: 'Log',
      preset: 'log',
    })
    const lines = page.locator('[data-panel=log] .tapet-log-line')
    execSync(pipe, { input: 'before\n' })
    await expect(lines).toHaveText(['before'])
    await expect(page.locator('.tapet-session-status')).toHaveCount(0)

    // As when the harness restarts `tapet mcp`: the window says so, and pipes still feed it.
    await tapet.reconnect()
    await expect(page.locator('.tapet-session-status')).toHaveText('No agent attached')
    execSync(pipe, { input: 'while detached\n' })
    await expect(lines).toHaveText(['before', 'while detached'])
    await expect(page.locator('[data-panel=log] .tapet-dot')).not.toHaveAttribute(
      'data-state',
      'ended',
    )

    expect(JSON.parse(text(await tapet.call('session_attach', { session })))).toEqual({ session })
    await expect(page.locator('.tapet-session-status')).toHaveCount(0)

    // Closing the window of a session no agent holds discards it, as remembered.
    await tapet.reconnect()
    await expect(page.locator('.tapet-session-status')).toHaveText('No agent attached')
    await tapet.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
    expect(text(await tapet.call('session_attach', { session }))).toContain(
      `there is no tapet session "${session}"`,
    )
  } finally {
    await tapet.close()
  }
})
