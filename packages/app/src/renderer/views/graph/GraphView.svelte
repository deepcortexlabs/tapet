<script lang="ts">
  import { Graph, type GraphConfig } from '@cosmos.gl/graph'
  import { onDestroy, untrack } from 'svelte'
  import type { Bridge } from '../../bridge.ts'
  import { onThemeChange, readTheme, toRgba, type ChartTheme } from '../theme.ts'
  import { hasWebGL2, noWebGL } from '../webgl.ts'
  import {
    LABEL_CANDIDATES,
    buildGraph,
    fieldsOf,
    labelOrder,
    pointSizes,
    type GraphData,
  } from './graph-model.ts'
  import { placeLabels, type LabelBox } from './labels.ts'
  import { HIERARCHICAL_LIMIT, hierarchicalPositions, placePoints, type Point } from './positions.ts'

  let props: { bridge: Bridge } = $props()
  // A view keeps its bridge for life; tapet remounts the view to change it.
  const bridge = untrack(() => props.bridge)

  // The force layout's space, and its middle, where nodes without neighbors start.
  const SPACE = 8192
  const CENTER: Point = [SPACE / 2, SPACE / 2]
  const LABEL_SIZE = 12
  const LABEL_LENGTH = 40
  const TOOLTIP_ROWS = 8

  let container: HTMLDivElement | undefined = $state()
  let overlay: HTMLCanvasElement | undefined = $state()
  let counts = $state({ nodes: 0, edges: 0 })
  let error = $state<string>()
  let tip = $state<{ x: number; y: number; title: string; rows: Array<[string, string]> }>()

  let graph: Graph | undefined
  let theme: ChartTheme | undefined
  let data: GraphData | undefined
  let sizes: Float32Array = new Float32Array()
  let hierarchical = false
  // Nodes that may get labels, most important first.
  let candidates: number[] = []
  // Once the user zooms or pans, the view stops fitting itself to the graph.
  let interacted = false
  let lastFit = 0
  let dataFrame = 0
  let labelFrame = 0
  let destroyed = false

  function colorsOf(current: ChartTheme): GraphConfig {
    const [red, green, blue] = toRgba(current.muted)
    return {
      backgroundColor: toRgba(current.surface),
      pointDefaultColor: toRgba(current.series[0] ?? current.fg),
      linkDefaultColor: [red, green, blue, 0.35],
      hoveredPointRingColor: toRgba(current.fg),
    }
  }

  // Colors by graph.color value: the series colors in order, then gray for the rest and for nodes
  // without a value.
  function pointColors(next: GraphData, current: ChartTheme): Float32Array {
    const palette = current.series.map(toRgba)
    const other = toRgba(current.muted)
    const colors = new Float32Array(next.nodes.length * 4)
    next.nodes.forEach((node, index) => {
      const group = node.group === undefined ? -1 : next.groups.indexOf(node.group)
      const plain = next.groups.length === 0
      const color = plain ? palette[0] : (palette[group] ?? other)
      colors.set(color ?? other, index * 4)
    })
    return colors
  }

  // The current place of every node, by id, so an update keeps the layout where it was.
  function currentPositions(): Map<string, Point> {
    const known = new Map<string, Point>()
    if (!graph || !data || hierarchical) {
      return known
    }

    const flat = graph.getPointPositions()
    data.nodes.forEach((node, index) => {
      const x = flat[index * 2]
      const y = flat[index * 2 + 1]
      if (x !== undefined && y !== undefined && !Number.isNaN(x)) {
        known.set(node.id, [x, y])
      }
    })
    return known
  }

  function sameStructure(a: GraphData, b: GraphData): boolean {
    return (
      a.nodes.length === b.nodes.length &&
      a.links.length === b.links.length &&
      a.nodes.every((node, index) => node.id === b.nodes[index]?.id) &&
      a.links.every((value, index) => value === b.links[index])
    )
  }

  function update() {
    dataFrame = 0
    if (!graph || !theme) {
      return
    }

    const next = buildGraph(bridge.entries(), bridge.settings().graph ?? {})
    if (next.warning) {
      bridge.reportError(next.warning)
    }

    counts = { nodes: next.nodes.length, edges: next.links.length / 2 }
    if (hierarchical && next.nodes.length > HIERARCHICAL_LIMIT) {
      error = `the hierarchical layout lays out up to ${HIERARCHICAL_LIMIT.toLocaleString()} nodes, and this graph has ${next.nodes.length.toLocaleString()}; use layout "force"`
      bridge.reportError(error)
      return
    }

    error = undefined
    sizes = pointSizes(next)
    const reshaped = !data || !sameStructure(data, next)
    if (reshaped) {
      const positions = hierarchical
        ? hierarchicalPositions(next, sizes)
        : placePoints(next, currentPositions(), CENTER)
      // The force layout keeps its own coordinates; hierarchical ones are fitted to the space.
      graph.setPointPositions(positions, !hierarchical)
      graph.setLinks(Float32Array.from(next.links))
    }

    graph.setPointColors(pointColors(next, theme))
    graph.setPointSizes(sizes)
    const first = !data
    data = next
    candidates = labelOrder(next)
    graph.trackPointPositionsByIndices(candidates)
    graph.render(undefined, 0)
    if (reshaped && !hierarchical) {
      // A new graph lays out from scratch; new nodes on an existing one only nudge it.
      graph.start(first ? 1 : 0.3)
    }

    if (reshaped && hierarchical && !first && !interacted) {
      graph.fitView(300)
    }

    scheduleLabels()
  }

  function scheduleUpdate() {
    dataFrame ||= requestAnimationFrame(update)
  }

  function scheduleLabels() {
    labelFrame ||= requestAnimationFrame(drawLabels)
  }

  function drawLabels() {
    labelFrame = 0
    const context = overlay?.getContext('2d')
    if (!overlay || !context || !graph || !data || !theme) {
      return
    }

    const ratio = devicePixelRatio
    const { clientWidth: width, clientHeight: height } = overlay
    if (overlay.width !== Math.round(width * ratio) || overlay.height !== Math.round(height * ratio)) {
      overlay.width = Math.round(width * ratio)
      overlay.height = Math.round(height * ratio)
    }

    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, width, height)
    context.font = `${LABEL_SIZE}px ${theme.font}`
    context.textBaseline = 'middle'
    const tracked = graph.getTrackedPointPositionsMap()
    const current = graph
    const nodes = data.nodes
    // Each label sits to the right of its point.
    const boxes = candidates.map((index): (LabelBox & { text: string }) | undefined => {
      const position = tracked.get(index)
      const node = nodes[index]
      if (!position || !node || Number.isNaN(position[0])) {
        return undefined
      }

      const [x, y] = current.spaceToScreenPosition(position)
      const text = node.label.length > LABEL_LENGTH ? `${node.label.slice(0, LABEL_LENGTH - 1)}…` : node.label
      const offset = (sizes[index] ?? 6) / 2 + 4
      const width = context.measureText(text).width
      return { x: x + offset, y: y - LABEL_SIZE / 2 - 2, width, height: LABEL_SIZE + 4, text }
    })

    // A halo in the surface color keeps labels legible over links.
    context.lineJoin = 'round'
    context.lineWidth = 3
    context.strokeStyle = theme.surface
    context.fillStyle = theme.fg
    // Graphs too big to label every node get at most one label per area of the view.
    const cell = nodes.length > LABEL_CANDIDATES ? { width: 120, height: 48 } : undefined
    for (const index of placeLabels(boxes, { width, height }, cell)) {
      const box = boxes[index]
      if (box) {
        context.strokeText(box.text, box.x, box.y + box.height / 2)
        context.fillText(box.text, box.x, box.y + box.height / 2)
      }
    }
  }

  // The node's label, then its other fields.
  function showTip(index: number, position: Point) {
    const node = data?.nodes[index]
    if (!graph || !node) {
      return
    }

    const { id } = fieldsOf(bridge.settings().graph ?? {})
    const [x, y] = graph.spaceToScreenPosition(position)
    const rows = Object.entries(node.item ?? {})
      .filter(([key]) => key !== id)
      .slice(0, TOOLTIP_ROWS)
      .map(([key, value]): [string, string] => [key, typeof value === 'string' ? value : JSON.stringify(value)])
    tip = { x, y, title: node.label, rows }
  }

  async function create() {
    if (!container) {
      return
    }

    if (!hasWebGL2()) {
      error = noWebGL('graph')
      bridge.reportError(error)
      return
    }

    theme = readTheme(container)
    hierarchical = bridge.settings().graph?.layout === 'hierarchical'
    graph = new Graph(container, {
      ...colorsOf(theme),
      spaceSize: SPACE,
      enableSimulation: !hierarchical,
      transitionDuration: 0,
      linkDefaultWidth: 1,
      fitViewOnInit: true,
      fitViewPadding: 0.15,
      // While the layout spreads the graph out, the view keeps all of it in sight.
      onSimulationTick: () => {
        if (!interacted && performance.now() - lastFit > 1000) {
          lastFit = performance.now()
          graph?.fitView(500, undefined, true)
        }

        scheduleLabels()
      },
      onSimulationEnd: () => {
        if (!interacted) {
          graph?.fitView(400)
        }

        scheduleLabels()
      },
      onZoom: (_, userDriven) => {
        interacted ||= userDriven
        tip = undefined
        scheduleLabels()
      },
      onDrag: scheduleLabels,
      onPointMouseOver: (index, position) => showTip(index, position),
      onPointMouseOut: () => {
        tip = undefined
      },
    })
    await graph.ready
    if (!destroyed) {
      update()
    }
  }

  // A new layout needs a new graph: the force layout runs a simulation, the hierarchical one doesn't.
  function recreate() {
    graph?.destroy()
    graph = undefined
    data = undefined
    sizes = new Float32Array()
    interacted = false
    void create()
  }

  const stopChanges = bridge.onChange(scheduleUpdate)
  const stopSettings = bridge.onSettings((settings) => {
    if ((settings.graph?.layout === 'hierarchical') !== hierarchical) {
      recreate()
      return
    }

    // The panel's CSS may have changed the theme's colors; it applies a frame later.
    requestAnimationFrame(() => {
      if (graph && container) {
        theme = readTheme(container)
        graph.setConfigPartial(colorsOf(theme))
      }

      update()
    })
  })
  const stopTheme = onThemeChange(() => {
    if (graph && container) {
      theme = readTheme(container)
      graph.setConfigPartial(colorsOf(theme))
      scheduleUpdate()
    }
  })
  const resizes = new ResizeObserver(scheduleLabels)

  $effect(() => {
    if (!container || !overlay) {
      return
    }

    resizes.observe(overlay)
    untrack(() => void create())
  })

  onDestroy(() => {
    destroyed = true
    cancelAnimationFrame(dataFrame)
    cancelAnimationFrame(labelFrame)
    stopChanges()
    stopSettings()
    stopTheme()
    resizes.disconnect()
    graph?.destroy()
  })
</script>

<div class="tapet-graph">
  <div class="tapet-graph-canvas" bind:this={container}></div>
  <canvas class="tapet-graph-labels" bind:this={overlay}></canvas>
  {#if tip}
    <div class="tapet-graph-tooltip" style:transform="translate({tip.x + 12}px, {tip.y + 12}px)">
      <strong>{tip.title}</strong>
      {#each tip.rows as [key, value], index (index)}
        <div><span class="tapet-graph-key">{key}</span> {value}</div>
      {/each}
    </div>
  {/if}
  {#if error}
    <p class="tapet-graph-error tapet-graph-message">{error}</p>
  {:else if counts.nodes === 0}
    <p class="tapet-empty tapet-graph-message">No data yet</p>
  {:else}
    <p class="tapet-graph-count">
      {counts.nodes.toLocaleString()} nodes · {counts.edges.toLocaleString()} edges
    </p>
  {/if}
</div>
