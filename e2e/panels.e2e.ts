import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { startTapet } from './tapet.ts'

test('double-clicking a title bar expands the panel over the window, and the layout stays put', async () => {
  const home = mkdtempSync(join(tmpdir(), 'tapet-e2e-'))
  const tapet = await startTapet({
    ...process.env,
    TAPET_HOME: home,
    TAPET_CONFIG: join(home, 'none'),
  })
  try {
    await tapet.call('window_update', {
      name: 'expand',
      width: 900,
      height: 600,
      css: '#tapet { display: grid; grid-template-columns: 1fr 1fr; }',
    })
    const page = await tapet.app.firstWindow()
    // Instant moves: the test checks where panels end up, not how they get there.
    await page.emulateMedia({ reducedMotion: 'reduce' })
    for (const id of ['a', 'b', 'c']) {
      await tapet.call('panel_create', { id, title: id.toUpperCase(), preset: 'log' })
    }

    const panel = (id: string) => page.locator(`[data-panel=${id}]`)
    const box = async (id: string) => await panel(id).boundingBox()
    const before = { a: await box('a'), b: await box('b'), c: await box('c') }
    const viewport = await page.evaluate(() => {
      const { innerWidth, innerHeight } = globalThis as unknown as Record<string, number>
      return { width: innerWidth ?? 0, height: innerHeight ?? 0 }
    })

    await panel('a').locator('.tapet-title').dblclick()
    await expect(panel('a')).toHaveClass(/tapet-expanded/)
    const expanded = await box('a')
    expect(Math.abs((expanded?.width ?? 0) - viewport.width * 0.9)).toBeLessThan(2)
    expect(Math.abs((expanded?.height ?? 0) - viewport.height * 0.9)).toBeLessThan(2)
    // Nothing else moved, and nothing else can be reached until the panel is back.
    expect(await box('b')).toEqual(before.b)
    expect(await box('c')).toEqual(before.c)
    await expect(panel('b')).toHaveJSProperty('inert', true)
    const { panels } = await tapet.json<{ panels: Array<{ id: string; expanded?: boolean }> }>(
      'window_inspect',
    )
    expect(panels.map((entry) => [entry.id, entry.expanded ?? false])).toEqual([
      ['a', true],
      ['b', false],
      ['c', false],
    ])

    // A click outside the panel puts it back where it was.
    await page.mouse.click(5, 5)
    await expect(panel('a')).not.toHaveClass(/tapet-expanded/)
    expect(await box('a')).toEqual(before.a)
    await expect(panel('b')).toHaveJSProperty('inert', false)

    // So do Escape, and another double-click on the title bar.
    await panel('b').locator('.tapet-title').dblclick()
    await expect(panel('b')).toHaveClass(/tapet-expanded/)
    await page.keyboard.press('Escape')
    await expect(panel('b')).not.toHaveClass(/tapet-expanded/)
    await panel('c').locator('.tapet-title').dblclick()
    await expect(panel('c')).toHaveClass(/tapet-expanded/)
    await panel('c').locator('.tapet-title').dblclick()
    await expect(panel('c')).not.toHaveClass(/tapet-expanded/)
    expect(await box('c')).toEqual(before.c)

    // The default layout, panels stacked in a flex column, stays put too.
    await tapet.call('window_update', { css: '' })
    const stacked = { a: await box('a'), c: await box('c') }
    await panel('b').locator('.tapet-title').dblclick()
    await expect(panel('b')).toHaveClass(/tapet-expanded/)
    expect(await box('a')).toEqual(stacked.a)
    expect(await box('c')).toEqual(stacked.c)
    await page.mouse.click(5, 5)
    await expect(panel('b')).not.toHaveClass(/tapet-expanded/)
  } finally {
    await tapet.close()
  }
})
