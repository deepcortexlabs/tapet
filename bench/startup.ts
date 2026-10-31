// Measures what every tapet window pays: the JavaScript its page loads at startup, and how long
// opening a window with one log panel takes, from window_update until the panel has rendered.
// Libraries may load more chunks on demand (mermaid's diagram types), counted only in the total.
// Run after `pnpm build`: node bench/startup.ts
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { _electron as electron } from '@playwright/test'

const ROOT = join(import.meta.dirname, '..')
const CLI = join(ROOT, 'packages', 'cli', 'src', 'main.ts')
const RUNS = 5

const renderer = join(ROOT, 'packages', 'app', 'out', 'renderer')
const size = (files: string[]) =>
  files.reduce((sum, file) => sum + statSync(join(renderer, file)).size, 0)
// The page's entry script and the chunks it preloads.
const startupFiles = [
  ...readFileSync(join(renderer, 'index.html'), 'utf8').matchAll(
    /(?:src|href)="\.\/(assets\/[^"]+\.js)"/g,
  ),
].map((match) => match[1] ?? '')
const allFiles = readdirSync(join(renderer, 'assets'))
  .filter((file) => file.endsWith('.js'))
  .map((file) => join('assets', file))

const home = mkdtempSync(join(tmpdir(), 'tapet-bench-'))
// A config path that doesn't exist keeps the user's own config out of the measurement.
const env = { ...process.env, TAPET_HOME: home, TAPET_CONFIG: join(home, 'none.json') }
const app = await electron.launch({ args: [join(ROOT, 'packages', 'app')], env })
const times: number[] = []

try {
  for (let run = 0; run < RUNS; run += 1) {
    const client = new Client({ name: 'bench', version: '0' })
    await client.connect(
      new StdioClientTransport({ command: process.execPath, args: [CLI, 'mcp'], env }),
    )
    const started = performance.now()
    await client.callTool({ name: 'window_update', arguments: { name: `bench ${run}` } })
    await client.callTool({
      name: 'panel_create',
      arguments: { id: 'log', title: 'Log', preset: 'log' },
    })
    times.push(performance.now() - started)
    await client.close()
  }
} finally {
  const exited = new Promise((resolve) => app.process().once('exit', resolve))
  await app.evaluate(({ app }) => app.quit())
  await exited
}

const sorted = [...times].sort((a, b) => a - b)
const median = sorted[Math.floor(sorted.length / 2)] ?? 0
console.log(
  JSON.stringify(
    {
      startupJsKiB: Math.round(size(startupFiles) / 1024),
      totalJsKiB: Math.round(size(allFiles) / 1024),
      windowOpenMs: {
        median: Math.round(median),
        min: Math.round(sorted[0] ?? 0),
        max: Math.round(sorted.at(-1) ?? 0),
      },
    },
    null,
    2,
  ),
)
