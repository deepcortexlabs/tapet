// Renders one synthetic graph with cosmos.gl, then reports the time until the first frame and the
// frame rate while the layout runs. The query string sets the graph's size.
import { Graph as Cosmos } from '@cosmos.gl/graph'

import type { BenchResult } from './result.ts'

declare global {
  interface Window {
    benchResult?: BenchResult
  }
}

const LAYOUT_SECONDS = 5
const params = new URLSearchParams(location.search)
const nodeCount = Number(params.get('nodes'))
const edgeCount = Number(params.get('edges'))
const container = document.getElementById('graph') as HTMLDivElement

interface Data {
  sources: Uint32Array
  targets: Uint32Array
  x: Float32Array
  y: Float32Array
}

// A seeded generator, so both libraries draw the same graph.
function mulberry32(seed: number) {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Communities give the layout something to find: 90% of edges stay inside one.
function generate(): Data {
  const random = mulberry32(42)
  const communities = Math.max(1, Math.round(Math.sqrt(nodeCount) / 2))
  const sources = new Uint32Array(edgeCount)
  const targets = new Uint32Array(edgeCount)
  for (let index = 0; index < edgeCount; index += 1) {
    const source = Math.floor(random() * nodeCount)
    const community = source % communities
    const members = Math.ceil((nodeCount - community) / communities)
    sources[index] = source
    targets[index] =
      random() < 0.9
        ? community + Math.floor(random() * members) * communities
        : Math.floor(random() * nodeCount)
  }

  const x = new Float32Array(nodeCount).map(() => random() * 1000)
  const y = new Float32Array(nodeCount).map(() => random() * 1000)
  return { sources, targets, x, y }
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

// Frames the page actually delivered, per second, while the layout keeps running.
function frameRate(seconds: number): Promise<number> {
  return new Promise((resolve) => {
    let frames = 0
    const start = performance.now()
    const tick = (now: number) => {
      frames += 1
      if (now - start < seconds * 1000) {
        requestAnimationFrame(tick)
        return
      }

      resolve(frames / ((now - start) / 1000))
    }
    requestAnimationFrame(tick)
  })
}

async function cosmos(data: Data) {
  const graph = new Cosmos(container, {
    spaceSize: 4096,
    fitViewOnInit: true,
    pointDefaultSize: 2,
    linkDefaultWidth: 0.5,
    backgroundColor: '#ffffff',
  })
  await graph.ready
  const positions = new Float32Array(nodeCount * 2)
  for (let index = 0; index < nodeCount; index += 1) {
    positions[index * 2] = (data.x[index] ?? 0) * 4
    positions[index * 2 + 1] = (data.y[index] ?? 0) * 4
  }

  const links = new Float32Array(edgeCount * 2)
  for (let index = 0; index < edgeCount; index += 1) {
    links[index * 2] = data.sources[index] ?? 0
    links[index * 2 + 1] = data.targets[index] ?? 0
  }

  graph.setPointPositions(positions)
  graph.setLinks(links)
  graph.render()
  await nextFrame()
  await nextFrame()
}

async function run(): Promise<BenchResult> {
  const data = generate()
  const started = performance.now()
  await cosmos(data)
  // cosmos.gl runs its layout from the first render on.
  const firstFrameMs = performance.now() - started
  return { firstFrameMs, layoutFps: await frameRate(LAYOUT_SECONDS) }
}

run()
  .then((result) => {
    window.benchResult = result
  })
  .catch((error: unknown) => {
    window.benchResult = { error: error instanceof Error ? error.message : String(error) }
  })
