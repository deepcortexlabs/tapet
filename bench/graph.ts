// Measures the graph view's library, cosmos.gl: for each graph size, the time until the first
// frame, the frame rate while the layout runs, and memory. Each case runs in a fresh Electron.
// It was chosen over sigma.js with this benchmark; see DESIGN.md for both libraries' numbers.
// Run: node bench/graph.ts, or name the cases to run, e.g. node bench/graph.ts "1k nodes".
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { _electron as electron, type ElectronApplication } from '@playwright/test'
import { build } from 'vite'
import type { BenchResult } from './graph/result.ts'

const HERE = join(import.meta.dirname, 'graph')
const OUT = join(HERE, 'out')
const CASES = [
  { name: '1k nodes', nodes: 1_000, edges: 1_500 },
  { name: '100k nodes', nodes: 100_000, edges: 150_000 },
  { name: '1M nodes', nodes: 1_000_000, edges: 1_500_000 },
  { name: '1.2k nodes, 72k edges', nodes: 1_200, edges: 72_000 },
  { name: '12k nodes, 1M edges', nodes: 12_000, edges: 1_000_000 },
]
const CASE_TIMEOUT_MS = 180_000

async function measure(nodes: number, edges: number) {
  const url = `${pathToFileURL(join(OUT, 'index.html')).href}?nodes=${nodes}&edges=${edges}`
  let app: ElectronApplication | undefined
  try {
    app = await electron.launch({
      args: [join(HERE, 'electron-main.mjs')],
      env: { ...process.env, BENCH_URL: url },
    })
    const page = await app.firstWindow()
    const handle = await page.waitForFunction(
      () => (globalThis as { benchResult?: BenchResult }).benchResult,
      undefined,
      { timeout: CASE_TIMEOUT_MS, polling: 500 },
    )
    const result: BenchResult = (await handle.jsonValue()) ?? { error: 'no result' }
    const memory = await app.evaluate(({ app, BrowserWindow }) => {
      const pid = BrowserWindow.getAllWindows()[0]?.webContents.getOSProcessId()
      const metrics = app.getAppMetrics()
      const megabytes = (metric?: Electron.ProcessMetric) =>
        Math.round((metric?.memory.workingSetSize ?? 0) / 1024)
      return {
        rendererMb: megabytes(metrics.find((metric) => metric.pid === pid)),
        gpuMb: megabytes(metrics.find((metric) => metric.type === 'GPU')),
      }
    })
    return { result, memory }
  } catch (error) {
    const message = error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error)
    return { result: { error: message }, memory: { rendererMb: 0, gpuMb: 0 } }
  } finally {
    await app?.close().catch((error: unknown) => {
      console.error(`closing Electron failed: ${String(error)}`)
    })
  }
}

await build({ root: HERE, base: './', logLevel: 'warn', build: { outDir: OUT, emptyOutDir: true } })

const only = process.argv.slice(2)
const rows: string[][] = []
for (const graph of CASES) {
  if (only.length > 0 && !only.includes(graph.name)) {
    continue
  }

  const { result, memory } = await measure(graph.nodes, graph.edges)
  const row = result.error
    ? [graph.name, `failed: ${result.error}`, '', '', '']
    : [
        graph.name,
        `${Math.round(result.firstFrameMs ?? 0)} ms`,
        `${Math.round(result.layoutFps ?? 0)} fps`,
        `${memory.rendererMb} MB`,
        `${memory.gpuMb} MB`,
      ]
  console.log(row.join(' | '))
  rows.push(row)
}

console.log('\n| graph | first frame | layout | renderer memory | GPU memory |')
console.log('| --- | --- | --- | --- | --- |')
for (const row of rows) {
  console.log(`| ${row.join(' | ')} |`)
}
