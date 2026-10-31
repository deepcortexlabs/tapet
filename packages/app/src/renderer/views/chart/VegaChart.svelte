<script lang="ts">
  import { onDestroy, untrack } from 'svelte'
  import { changeset, parse, View } from 'vega'
  import { expressionInterpreter } from 'vega-interpreter'
  import { compile, type TopLevelSpec } from 'vega-lite'
  import type { Bridge } from '../../bridge.ts'
  import { onThemeChange, readTheme } from '../theme.ts'
  import { fillsPanel, themedSpec, toDatum } from './vega-options.ts'

  let props: { bridge: Bridge } = $props()
  const bridge = untrack(() => props.bridge)

  // Updates to the chart's data are batched to about 30 per second.
  const FEED_INTERVAL = 33
  const NO_DATA =
    'chart.spec has no data named "tapet", so the panel\'s data isn\'t shown; set "data": { "name": "tapet" }'

  let element: HTMLDivElement | undefined = $state()
  let error = $state<string>()
  let view: View | undefined
  let fills = false
  let feeds = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let frame = 0

  function fail(message: string) {
    error = message
    bridge.reportError(message)
  }

  function feed() {
    timer = undefined
    if (!view || !feeds) {
      return
    }

    const values = bridge.entries().map((entry) => toDatum(entry.value))
    // New data can change the axes and legend, so the layout is fitted again.
    view
      .change(
        'tapet',
        changeset()
          .remove(() => true)
          .insert(values),
      )
      .resize()
      .runAsync()
      .catch((reason: unknown) => fail(`chart.spec: ${String(reason)}`))
  }

  function resize() {
    if (!view || !fills || !element) {
      return
    }

    view
      .width(element.clientWidth)
      .height(element.clientHeight)
      .resize()
      .runAsync()
      .catch((reason: unknown) => fail(`chart.spec: ${String(reason)}`))
  }

  function build() {
    view?.finalize()
    view = undefined
    if (!element) {
      return
    }

    const spec = bridge.settings().chart?.spec ?? {}
    try {
      const compiled = compile(themedSpec(spec, readTheme(element)) as unknown as TopLevelSpec).spec
      fills = fillsPanel(spec)
      feeds = compiled.data?.some((data) => data.name === 'tapet') ?? false
      // The interpreter evaluates Vega's expressions without eval, which the window doesn't allow.
      view = new View(parse(compiled, undefined, { ast: true }), {
        container: element,
        renderer: 'svg',
        hover: true,
        expr: expressionInterpreter,
      })
      error = undefined
    } catch (reason) {
      fail(`chart.spec: ${reason instanceof Error ? reason.message : String(reason)}`)
      return
    }

    if (!feeds) {
      bridge.reportError(NO_DATA)
    }

    resize()
    feed()
  }

  const stopChanges = bridge.onChange(() => {
    timer ??= setTimeout(feed, FEED_INTERVAL)
  })
  // Settings rebuild the chart a frame later, once the panel's new CSS (and so its colors) is in place.
  function scheduleBuild() {
    frame ||= requestAnimationFrame(() => {
      frame = 0
      build()
    })
  }

  const stopSettings = bridge.onSettings(scheduleBuild)
  const stopTheme = onThemeChange(scheduleBuild)
  const resizes = new ResizeObserver(resize)

  $effect(() => {
    if (!element) {
      return
    }

    resizes.observe(element)
    untrack(build)
  })

  onDestroy(() => {
    clearTimeout(timer)
    cancelAnimationFrame(frame)
    stopChanges()
    stopSettings()
    stopTheme()
    resizes.disconnect()
    view?.finalize()
  })
</script>

<div class="tapet-chart tapet-chart-vega">
  <div class="tapet-chart-plot" bind:this={element}></div>
  {#if error}
    <p class="tapet-chart-error tapet-chart-message">{error}</p>
  {/if}
</div>
