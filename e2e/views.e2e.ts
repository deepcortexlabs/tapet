import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { startTapet, type Tapet } from './tapet.ts'

let tapet: Tapet
let page: Page

test.beforeAll(async () => {
  const home = mkdtempSync(join(tmpdir(), 'tapet-e2e-'))
  tapet = await startTapet({ ...process.env, TAPET_HOME: home, TAPET_CONFIG: join(home, 'none') })
  await tapet.call('window_update', { name: 'views', width: 900, height: 700 })
  page = await tapet.app.firstWindow()
})

test.afterAll(async () => {
  await tapet.close()
})

async function createPanel(settings: Record<string, unknown>) {
  const { pipe } = await tapet.json<{ pipe: string }>('panel_create', settings)
  return (input: string | Buffer) => execSync(pipe, { input })
}

// The panel's PNG as the agent gets it from window_screenshot.
async function screenshot(panel: string): Promise<Buffer> {
  const [image] = (await tapet.call('window_screenshot', { panel })).content
  return Buffer.from(image?.type === 'image' ? image.data : '', 'base64')
}

test('table: rows, sorting by a column, and explicit columns', async () => {
  const send = await createPanel({ id: 'jobs', title: 'Jobs', preset: 'table' })
  const panel = page.locator('[data-panel=jobs]')
  await expect(panel.locator('.tapet-empty')).toHaveText('No rows yet')
  const empty = await screenshot('jobs')

  send('{"name":"b","runs":10}\n{"name":"a","runs":9}\n{"name":"c","runs":100,"tags":["x"]}\n')
  const names = panel.locator('.tapet-table-row .tapet-table-cell:first-child')
  await expect(panel.locator('.tapet-table-heading')).toHaveText(['name', 'runs', 'tags'])
  await expect(names).toHaveText(['b', 'a', 'c'])
  await expect(panel.locator('.tapet-table-row').last()).toContainText('["x"]')
  expect((await screenshot('jobs')).length).toBeGreaterThan(empty.length)

  await panel.getByTitle('Sort by runs').click()
  await expect(names).toHaveText(['a', 'b', 'c'])
  await panel.getByTitle('Sort by runs').click()
  await expect(names).toHaveText(['c', 'b', 'a'])

  await tapet.call('panel_update', { id: 'jobs', table: { columns: ['runs', 'name'] } })
  await expect(panel.locator('.tapet-table-heading')).toHaveText(['runs', 'name'])
  await tapet.call('panel_remove', { id: 'jobs' })
})

test('document: markdown with code, math and diagrams; sanitized HTML; images', async () => {
  const send = await createPanel({ id: 'doc', title: 'Doc', preset: 'document' })
  const panel = page.locator('[data-panel=doc]')
  await expect(panel.locator('.tapet-empty')).toHaveText('No document yet')
  const empty = await screenshot('doc')

  send(
    [
      '# Report',
      '',
      '```js',
      'const answer = 42',
      '```',
      '',
      'Energy: $E = mc^2$',
      '',
      '```mermaid',
      'graph LR',
      '  A --> B',
      '```',
    ].join('\n'),
  )
  await expect(panel.locator('h1')).toHaveText('Report')
  await expect(panel.locator('pre code.language-js .hljs-keyword')).toHaveText('const')
  await expect(panel.locator('.katex')).toHaveCount(1)
  await expect(panel.locator('.tapet-mermaid svg')).toHaveCount(1)
  expect((await screenshot('doc')).length).toBeGreaterThan(empty.length)

  await tapet.call('panel_update', { id: 'doc', document: { content: 'html' } })
  send('<style>p { color: rgb(255, 0, 0) }</style><p>Styled</p><script>window.ran = true</script>')
  const paragraph = panel.locator('.tapet-document-html p')
  await expect(paragraph).toHaveText('Styled')
  await expect(paragraph).toHaveCSS('color', 'rgb(255, 0, 0)')
  // The document's styles stay inside it, and its scripts never run.
  await expect(page.locator('.tapet-empty, .tapet-title-text').first()).not.toHaveCSS(
    'color',
    'rgb(255, 0, 0)',
  )
  expect(await page.evaluate(() => 'ran' in globalThis)).toBe(false)

  await tapet.call('panel_update', { id: 'doc', document: { content: 'image' } })
  send(empty)
  const image = panel.locator('img.tapet-document-image')
  await expect(image).toHaveJSProperty('complete', true)
  // The image decoded: an image that failed has no natural size.
  expect(await image.evaluate((element) => Reflect.get(element, 'naturalWidth'))).toBeGreaterThan(0)
  await tapet.call('panel_remove', { id: 'doc' })
})

test('gauge: the latest value, thresholds, styles, and data it cannot show', async () => {
  const send = await createPanel({
    id: 'cpu',
    title: 'CPU',
    preset: 'gauge',
    gauge: { unit: '%', thresholds: [{ at: 90, color: 'rgb(215, 0, 21)' }] },
  })
  const panel = page.locator('[data-panel=cpu]')
  await expect(panel.locator('.tapet-empty')).toHaveText('No value yet')
  const empty = await screenshot('cpu')

  send('42\n')
  await expect(panel.locator('.tapet-gauge-value')).toHaveText('42%')
  expect((await screenshot('cpu')).length).toBeGreaterThan(empty.length)
  send('95\n')
  await expect(panel.locator('.tapet-gauge-value')).toHaveText('95%')
  await expect(panel.locator('.tapet-gauge-value')).toHaveCSS('color', 'rgb(215, 0, 21)')

  await tapet.call('panel_update', { id: 'cpu', gauge: { style: 'dial', max: 200 } })
  await expect(panel.locator('.tapet-gauge-fill')).toHaveAttribute('stroke-dasharray', '0.475 1')

  const sendObjects = await createPanel({
    id: 'mem',
    title: 'Memory',
    preset: 'gauge',
    format: 'ndjson',
  })
  sendObjects('{"used": 3}\n')
  await expect(page.locator('[data-panel=mem] .tapet-gauge-error')).toContainText('set gauge.value')
  const { notices } = await tapet.json<{ notices?: string[] }>('window_get')
  expect(notices).toEqual([expect.stringContaining('set gauge.value')])
  await tapet.call('panel_remove', { id: 'cpu' })
  await tapet.call('panel_remove', { id: 'mem' })
})
