<script lang="ts">
  import { followsNewest } from '@tapet/core'
  import { onDestroy, untrack } from 'svelte'
  import uPlot from 'uplot'
  import 'uplot/dist/uPlot.min.css'
  import type { Bridge } from '../../bridge.ts'
  import { chartData, type ChartResult } from './chart-model.ts'
  import { onThemeChange, readTheme } from '../theme.ts'
  import { plotOptions } from './uplot-options.ts'

  let props: { bridge: Bridge } = $props()
  const bridge = untrack(() => props.bridge)

  let element: HTMLDivElement | undefined = $state()
  let result = $state.raw<ChartResult>({ kind: 'empty' })
  let type = $state(bridge.settings().chart?.type ?? 'line')
  let plot: uPlot | undefined
  // What the plot was built for: its series, and whether x is time. Data of another shape rebuilds it.
  let shape = ''
  // The user zoomed in; new data keeps their zoom until a double-click resets it.
  let zoomed = false
  let frame = 0
  let rebuildPending = false

  function destroyPlot() {
    plot?.destroy()
    plot = undefined
    shape = ''
  }

  // Fits the plot and its legend into the panel.
  function fit() {
    if (!plot || !element) {
      return
    }

    const legend = plot.root.querySelector<HTMLElement>('.u-legend')
    const height = element.clientHeight - (legend?.offsetHeight ?? 0)
    plot.setSize({ width: element.clientWidth, height: Math.max(60, height) })
  }

  function render(rebuild: boolean) {
    frame = 0
    rebuildPending = false
    const settings = bridge.settings()
    result = chartData(bridge.entries(), settings.chart ?? {})
    if (result.kind === 'error' || (result.kind === 'data' && result.warning)) {
      bridge.reportError(result.kind === 'error' ? result.message : (result.warning ?? ''))
    }

    if (!element || result.kind !== 'data') {
      destroyPlot()
      return
    }

    const { data } = result
    const aligned: uPlot.AlignedData = [data.x, ...data.series.map((series) => series.values)]
    const nextShape = JSON.stringify([data.time, data.series.map((series) => series.label)])
    if (plot && !rebuild && nextShape === shape) {
      plot.setData(aligned, !zoomed && followsNewest(settings))
      return
    }

    destroyPlot()
    zoomed = false
    const size = { width: element.clientWidth, height: element.clientHeight }
    const events = { zoom: () => (zoomed = true) }
    plot = new uPlot(plotOptions(data, settings.chart ?? {}, readTheme(element), size, events), aligned, element)
    plot.over.addEventListener('dblclick', () => {
      zoomed = false
    })
    shape = nextShape
    fit()
  }

  // Data can arrive much faster than the screen redraws: draw once per frame. Settings rebuild
  // the plot a frame later too, once the panel's new CSS (and so its colors) is in place.
  function schedule(rebuild = false) {
    rebuildPending ||= rebuild
    frame ||= requestAnimationFrame(() => render(rebuildPending))
  }

  const stopChanges = bridge.onChange(() => schedule())
  const stopSettings = bridge.onSettings((settings) => {
    type = settings.chart?.type ?? 'line'
    schedule(true)
  })
  const stopTheme = onThemeChange(() => schedule(true))
  const resizes = new ResizeObserver(fit)

  $effect(() => {
    if (!element) {
      return
    }

    resizes.observe(element)
    untrack(() => render(true))
  })

  onDestroy(() => {
    cancelAnimationFrame(frame)
    stopChanges()
    stopSettings()
    stopTheme()
    resizes.disconnect()
    destroyPlot()
  })
</script>

<div class="tapet-chart" data-type={type}>
  <div class="tapet-chart-plot" bind:this={element}></div>
  {#if result.kind === 'empty'}
    <p class="tapet-empty tapet-chart-message">No data yet</p>
  {:else if result.kind === 'error'}
    <p class="tapet-chart-error tapet-chart-message">{result.message}</p>
  {/if}
</div>
