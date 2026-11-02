import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { countPixels } from './png.ts'
import { startTapet, text, type Tapet } from './tapet.ts'

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

test('chart: uPlot series with a legend and a readout, and a Vega-Lite spec', async () => {
  const send = await createPanel({
    id: 'latency',
    title: 'Latency',
    preset: 'timeseries',
    chart: { x: 'i', y: ['p50', 'p99'] },
  })
  const panel = page.locator('[data-panel=latency]')
  await expect(panel.locator('.tapet-empty')).toHaveText('No data yet')
  const empty = await screenshot('latency')

  const points = Array.from({ length: 20 }, (_, i) => ({ i, p50: 10 + (i % 5), p99: 40 + (i % 7) }))
  send(`${points.map((point) => JSON.stringify(point)).join('\n')}\n`)
  await expect(panel.locator('.u-legend .u-label')).toHaveText(['p50', 'p99'])
  expect((await screenshot('latency')).length).toBeGreaterThan(empty.length)
  await panel.locator('.u-over').hover()
  await expect(panel.locator('.tapet-chart-tooltip-row')).toHaveCount(2)

  // Series colors are theme variables, so the panel's CSS can change them.
  await tapet.call('panel_update', {
    id: 'latency',
    css: ':scope { --tapet-series-1: rgb(255, 0, 0) }',
  })
  await expect(panel.locator('.u-legend .u-marker').first()).toHaveCSS(
    'background-color',
    'rgb(255, 0, 0)',
  )

  const bars = {
    data: { name: 'tapet' },
    mark: 'bar',
    encoding: { x: { field: 'i', type: 'ordinal' }, y: { field: 'p50', type: 'quantitative' } },
  }
  await tapet.call('panel_update', { id: 'latency', chart: { engine: 'vega-lite', spec: bars } })
  await expect(panel.locator('.mark-rect path')).toHaveCount(20)

  // A spec that doesn't read the panel's data gets a notice, with this result or the next one.
  const unfed = { data: { values: [{ a: 1 }] }, mark: 'point' }
  const updated = await tapet.call('panel_update', {
    id: 'latency',
    chart: { engine: 'vega-lite', spec: unfed },
  })
  const later = await tapet.call('window_get')
  expect(`${text(updated)} ${text(later)}`).toContain('no data named \\"tapet\\"')
  await tapet.call('panel_remove', { id: 'latency' })
})

test('graph: nodes and edges, including nodes only edges mention, in both layouts', async () => {
  const send = await createPanel({
    id: 'deps',
    title: 'Dependencies',
    format: 'ndjson',
    update: 'append',
    view: 'graph',
    graph: { label: 'name' },
  })
  const panel = page.locator('[data-panel=deps]')
  await expect(panel.locator('.tapet-empty')).toHaveText('No data yet')
  const empty = await screenshot('deps')

  const items = [
    { id: 'app', name: 'App' },
    { source: 'app', target: 'core' },
    { source: 'app', target: 'cli' },
    { source: 'cli', target: 'core' },
  ]
  send(`${items.map((item) => JSON.stringify(item)).join('\n')}\n`)
  await expect(panel.locator('.tapet-graph-count')).toHaveText('3 nodes · 3 edges')
  await expect(panel.locator('.tapet-graph-canvas canvas')).toHaveCount(1)
  expect((await screenshot('deps')).length).toBeGreaterThan(empty.length)

  await tapet.call('panel_update', { id: 'deps', graph: { label: 'name', layout: 'hierarchical' } })
  await expect(panel.locator('.tapet-graph-count')).toHaveText('3 nodes · 3 edges')
  await tapet.call('panel_remove', { id: 'deps' })
})

test('map: GeoJSON features colored by a value, with a legend and a tooltip, offline', async () => {
  const send = await createPanel({
    id: 'votes',
    title: 'Votes',
    preset: 'map',
    map: { base_map: false, color_by: 'votes', tooltip: ['name', 'votes'] },
  })
  const panel = page.locator('[data-panel=votes]')
  await expect(panel.locator('.tapet-map-count')).toHaveText('No data yet')
  const empty = await screenshot('votes')

  const square = (id: string, name: string, votes: number, lon: number) => ({
    type: 'Feature',
    id,
    properties: { name, votes },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [lon, 31],
          [lon + 1, 31],
          [lon + 1, 32],
          [lon, 32],
          [lon, 31],
        ],
      ],
    },
  })
  const city = {
    type: 'Feature',
    id: 'c',
    properties: { name: 'City' },
    geometry: { type: 'Point', coordinates: [35, 31.5] },
  }
  send(
    `${[square('a', 'West', 100, 34), square('b', 'East', 900, 35), city].map((item) => JSON.stringify(item)).join('\n')}\n`,
  )
  await expect(panel.locator('.tapet-map-count')).toHaveText('3 features')
  await expect(panel.locator('.tapet-map-range')).toHaveText('100900')
  expect((await screenshot('votes')).length).toBeGreaterThan(empty.length)

  // The view zoomed to the data, so a quarter of the way across is inside the western square.
  const box = await panel.locator('.tapet-map-canvas').boundingBox()
  await page.mouse.move(
    (box?.x ?? 0) + (box?.width ?? 0) * 0.3,
    (box?.y ?? 0) + (box?.height ?? 0) * 0.5,
  )
  await expect(panel.locator('.tapet-map-tooltip')).toContainText('West')
  await tapet.call('panel_remove', { id: 'votes' })
})

test('map: features in their own colors and sizes, and labels, offline', async () => {
  const send = await createPanel({
    id: 'styled',
    title: 'Styled',
    preset: 'map',
    map: { base_map: false, color_by: 'votes' },
  })
  const panel = page.locator('[data-panel=styled]')
  const red = async () =>
    countPixels(await screenshot('styled'), (r, g, b) => r > 180 && g < 100 && b < 100)
  const blue = async () =>
    countPixels(await screenshot('styled'), (r, g, b) => b > 180 && r < 100 && g < 100)
  const area = {
    type: 'Feature',
    id: 'area',
    properties: { votes: 1, fill: '#ff0000', 'fill-opacity': 1 },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [34, 31],
          [35, 31],
          [35, 32],
          [34, 32],
          [34, 31],
        ],
      ],
    },
  }
  const place = {
    type: 'Feature',
    id: 'place',
    properties: { votes: 2, 'marker-color': '#0000ff', 'marker-size': 12 },
    geometry: { type: 'Point', coordinates: [35.5, 31.5] },
  }
  send(`${JSON.stringify(area)}\n${JSON.stringify(place)}\n`)
  await expect(panel.locator('.tapet-map-count')).toHaveText('2 features')
  // The features' own colors win over the color_by scale's blues.
  await expect.poll(red).toBeGreaterThan(1000)
  expect(await blue()).toBeGreaterThan(200)

  // The label is drawn in the window's own font, without the network, over part of the area.
  const unlabeled = await red()
  send(
    `${JSON.stringify({ ...area, properties: { ...area.properties, label: 'Haifa District' } })}\n`,
  )
  await expect.poll(red).toBeLessThan(unlabeled - 100)
  await tapet.call('panel_remove', { id: 'styled' })
})

test('custom: agent code renders panel data in a sandbox, and its errors fail the call', async () => {
  const code = `
    const list = document.createElement('ul')
    tapet.root.append(list)
    const draw = () =>
      list.replaceChildren(...tapet.entries().map((entry) =>
        Object.assign(document.createElement('li'), { textContent: entry.value.name })))
    draw()
    tapet.onChange(draw)
    // The sandbox: no way into tapet's window, and no hosts beyond the allowed ones.
    let reached = 'yes'
    try { parent.document.title } catch { reached = 'blocked' }
    let fetched = 'yes'
    try { await fetch('https://example.com/') } catch { fetched = 'blocked' }
    tapet.root.dataset.parent = reached
    tapet.root.dataset.fetch = fetched
  `
  const send = await createPanel({
    id: 'own',
    title: 'Own code',
    format: 'ndjson',
    update: 'append',
    view: 'custom',
    custom: { code },
  })
  const frame = page.frameLocator('[data-panel=own] iframe')
  send('{"name":"alpha"}\n{"name":"beta"}\n')
  await expect(frame.locator('li')).toHaveText(['alpha', 'beta'])
  await expect(frame.locator('#root')).toHaveAttribute('data-parent', 'blocked')
  await expect(frame.locator('#root')).toHaveAttribute('data-fetch', 'blocked')

  // A thrown error is the call's error, once: not repeated as a notice.
  const failed = text(
    await tapet.call('panel_update', {
      id: 'own',
      custom: { code: "throw new Error('broken on purpose')" },
    }),
  )
  expect(failed).toContain('failed to render: broken on purpose')
  expect(failed.match(/broken on purpose/g)).toHaveLength(1)
  await tapet.call('panel_remove', { id: 'own' })
})
