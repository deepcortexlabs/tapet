<script lang="ts">
  import type { MapSettings } from '@tapet/core'
  import {
    Map as MapLibre,
    setWorkerUrl,
    type ErrorEvent,
    type ExpressionSpecification,
    type GeoJSONSource,
    type MapMouseEvent,
    type StyleSpecification,
  } from 'maplibre-gl'
  import 'maplibre-gl/dist/maplibre-gl.css'
  import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
  import { onDestroy, untrack } from 'svelte'
  import type { Bridge } from '../../bridge.ts'
  import { SEQUENTIAL, onThemeChange, readTheme, type ChartTheme } from '../theme.ts'
  import { hasWebGL2, noWebGL } from '../webgl.ts'
  import {
    SCALE,
    SOURCE,
    buildMap,
    labelField,
    layersOf,
    legendOf,
    neutralize,
    type CategoryLegend,
    type MapColors,
  } from './map-model.ts'

  let props: { bridge: Bridge } = $props()
  // A view keeps its bridge for life; tapet remounts the view to change it.
  const bridge = untrack(() => props.bridge)

  // MapLibre looks for its worker next to its own module only when the page is served over http;
  // tapet's window is a file, so it gets the URL of the worker bundled with the view.
  setWorkerUrl(new URL(workerUrl, document.baseURI).href)

  const STYLES = 'https://tiles.openfreemap.org/styles'
  const TOOLTIP_ROWS = 8
  const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })

  let container: HTMLDivElement | undefined = $state()
  let count = $state(0)
  let loading = $state(true)
  let failure = $state<string>()
  // The legend: categories with their colors, or the color_by scale.
  let categories = $state<CategoryLegend>()
  let scale = $state<{ field: string; low: string; high: string; gradient: string }>()
  let tip = $state<{ x: number; y: number; rows: Array<[string, string]> }>()

  let map: MapLibre | undefined
  let theme: ChartTheme | undefined
  let loaded = false
  // The view zooms to the data once, when it first arrives.
  let fitted = false
  let frame = 0
  let slowTimer: ReturnType<typeof setTimeout> | undefined
  // What the current style was built from; a change loads a new one.
  let styleKey = ''
  // The panel's layers on the map, and what they were built from; a change replaces them.
  let layerIds: string[] = []
  let layerKey = ''
  const SLOW_STYLE_MS = 15_000

  function settings(): MapSettings {
    return bridge.settings().map ?? {}
  }

  // Whether the map underneath is dark: a named base map says, and the rest follow the theme.
  function isDark(current: ChartTheme): boolean {
    const { base_map: baseMap } = settings()
    return baseMap === 'dark' || (baseMap !== 'light' && current.dark)
  }

  function ramp(current: ChartTheme): string[] {
    const { colors } = settings()
    if (colors) {
      return colors
    }

    // On a dark map the ramp runs the other way, so low values recede into it.
    return isDark(current) ? SEQUENTIAL.toReversed() : SEQUENTIAL
  }

  function colorsOf(current: ChartTheme): MapColors {
    return {
      color: current.series[0] ?? current.fg,
      fg: current.fg,
      muted: current.muted,
      surface: current.surface,
      ramp: ramp(current),
    }
  }

  function baseStyle(current: ChartTheme): string | StyleSpecification {
    const { base_map: baseMap } = settings()
    if (baseMap === false) {
      return {
        version: 8,
        sources: {},
        layers: [{ id: 'background', type: 'background', paint: { 'background-color': current.surface } }],
      }
    }

    if (baseMap === undefined || baseMap === 'light' || baseMap === 'dark') {
      return `${STYLES}/${isDark(current) ? 'dark' : 'positron'}`
    }

    return baseMap
  }

  function keyOf(current: ChartTheme): string {
    const { label_language: language, borders } = settings()
    return JSON.stringify([baseStyle(current), language, borders])
  }

  // Unless map.borders is on, the base map shows no country or region borders and names.
  function applyBorders() {
    if (!map || settings().borders) {
      return
    }

    const layers = map.getStyle().layers as Parameters<typeof neutralize>[0]
    for (const change of neutralize(layers)) {
      if (change.hide) {
        map.setLayoutProperty(change.id, 'visibility', 'none')
        continue
      }

      map.setFilter(change.id, change.filter as Parameters<MapLibre['setFilter']>[1])
    }
  }

  // The base map's labels in the chosen language, falling back to the local name.
  function localizeLabels() {
    const language = settings().label_language ?? 'en'
    for (const layer of map?.getStyle().layers ?? []) {
      const field = layer.type === 'symbol' ? JSON.stringify(layer.layout?.['text-field'] ?? '') : ''
      if (field.includes('name')) {
        map?.setLayoutProperty(layer.id, 'text-field', labelField(language) as ExpressionSpecification)
      }
    }
  }

  // The panel's shapes go over the base map's roads and areas but under its labels, so place
  // names stay readable: before the first label that follows the last shape layer. The panel's own
  // labels go on top, so they win where they collide with the base map's.
  function setLayers(current: ChartTheme) {
    if (!map) {
      return
    }

    const layers = layersOf(colorsOf(current), settings())
    const key = JSON.stringify(layers)
    if (key === layerKey) {
      return
    }

    for (const id of layerIds) {
      map.removeLayer(id)
    }

    const style = map.getStyle().layers
    const lastShape = style.findLastIndex((layer) => layer.type !== 'symbol')
    const labels = style.slice(lastShape + 1).find((layer) => layer.type === 'symbol')?.id
    for (const layer of layers) {
      map.addLayer(layer, layer.type === 'symbol' ? undefined : labels)
    }

    layerIds = layers.map((layer) => layer.id)
    layerKey = key
  }

  function update() {
    frame = 0
    if (!map || !theme) {
      return
    }

    const data = buildMap(bridge.entries(), settings())
    if (data.warning) {
      bridge.reportError(data.warning)
    }

    count = data.features.length
    const { color_by: field } = settings()
    const colors = ramp(theme)
    categories = legendOf(settings())
    scale =
      field && data.range
        ? {
            field,
            low: number.format(data.range[0]),
            high: number.format(data.range[1]),
            gradient: `linear-gradient(to right, ${colors.join(', ')})`,
          }
        : undefined
    // Features go on the map once its style has loaded; until then, the panel says it's loading.
    if (!loaded) {
      return
    }

    const collection = { type: 'FeatureCollection', features: data.features }
    map.getSource<GeoJSONSource>(SOURCE)?.setData(collection as Parameters<GeoJSONSource['setData']>[0])
    if (!fitted && data.bounds) {
      fitted = true
      map.fitBounds(data.bounds, { padding: 32, maxZoom: 14, animate: false })
    }
  }

  function scheduleUpdate() {
    frame ||= requestAnimationFrame(update)
  }

  // The tooltip lists map.tooltip's properties, or all of them, of the topmost feature under the
  // pointer.
  function hover(event: MapMouseEvent) {
    const [feature] = loaded ? (map?.queryRenderedFeatures(event.point, { layers: layerIds }) ?? []) : []
    if (!feature) {
      hideTip()
      return
    }

    const properties = feature.properties
    const keys = settings().tooltip ?? Object.keys(properties).filter((key) => key !== SCALE)
    const rows = keys
      .filter((key) => properties[key] !== undefined)
      .slice(0, TOOLTIP_ROWS)
      .map((key): [string, string] => {
        const value: unknown = properties[key]
        return [key, typeof value === 'number' ? number.format(value) : String(value)]
      })
    tip = rows.length > 0 ? { x: event.point.x, y: event.point.y, rows } : undefined
    if (map) {
      map.getCanvas().style.cursor = 'pointer'
    }
  }

  function hideTip() {
    tip = undefined
    if (map) {
      map.getCanvas().style.cursor = ''
    }
  }

  // A base map that doesn't load leaves the panel without features: tell the agent the way out.
  function watchStyle() {
    loading = true
    clearTimeout(slowTimer)
    slowTimer = setTimeout(() => {
      if (!loaded) {
        bridge.reportError(
          `the base map hasn't loaded after ${SLOW_STYLE_MS / 1000} seconds; map.base_map: false draws only the features`,
        )
      }
    }, SLOW_STYLE_MS)
  }

  function create() {
    if (!container) {
      return
    }

    if (!hasWebGL2()) {
      failure = noWebGL('map')
      loading = false
      bridge.reportError(failure)
      return
    }

    theme = readTheme(container)
    styleKey = keyOf(theme)
    map = new MapLibre({
      container,
      style: baseStyle(theme),
      attributionControl: { compact: true },
      center: [0, 20],
      zoom: 1,
      // One world: without copies, MapLibre keeps the world across the panel's whole width.
      renderWorldCopies: false,
    })
    // A new style starts empty: the panel's source and layers go back on it.
    map.on('style.load', () => {
      if (!map || !theme) {
        return
      }

      localizeLabels()
      applyBorders()
      map.addSource(SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      layerIds = []
      layerKey = ''
      setLayers(theme)
      loaded = true
      loading = false
      clearTimeout(slowTimer)
      update()
    })
    map.on('error', (event: ErrorEvent) => {
      bridge.reportError(`the base map didn't load (${event.error.message}); map.base_map: false draws only the features`)
    })
    map.on('mousemove', hover)
    map.on('mouseout', hideTip)

    watchStyle()
    update()
  }

  // The theme or the settings changed: a new style, or new layers.
  function restyle() {
    if (!map || !container) {
      return
    }

    theme = readTheme(container)
    const key = keyOf(theme)
    if (key !== styleKey) {
      styleKey = key
      loaded = false
      watchStyle()
      map.setStyle(baseStyle(theme))
      return
    }

    if (loaded) {
      setLayers(theme)
      update()
    }
  }

  const stopChanges = bridge.onChange(scheduleUpdate)
  // The panel's CSS may have changed the theme's colors; it applies a frame later.
  const stopSettings = bridge.onSettings(() => requestAnimationFrame(restyle))
  const stopTheme = onThemeChange(restyle)
  const resizes = new ResizeObserver(() => map?.resize())

  $effect(() => {
    if (!container) {
      return
    }

    resizes.observe(container)
    untrack(create)
  })

  onDestroy(() => {
    cancelAnimationFrame(frame)
    clearTimeout(slowTimer)
    stopChanges()
    stopSettings()
    stopTheme()
    resizes.disconnect()
    map?.remove()
  })
</script>

<div class="tapet-map">
  <!-- MapLibre makes its container position: relative, so it fills a box of tapet's. -->
  <div class="tapet-map-canvas"><div class="tapet-map-container" bind:this={container}></div></div>
  {#if tip}
    <div class="tapet-map-tooltip" style:transform="translate({tip.x + 12}px, {tip.y + 12}px)">
      {#each tip.rows as [key, value], index (index)}
        <div><span class="tapet-map-key">{key}</span> {value}</div>
      {/each}
    </div>
  {/if}
  {#if failure}
    <p class="tapet-map-error">{failure}</p>
  {/if}
  <div class="tapet-map-info">
    {#if categories}
      <div class="tapet-map-legend">
        {#if categories.title}
          <span class="tapet-map-key">{categories.title}</span>
        {/if}
        <ul class="tapet-map-swatches">
          {#each categories.items as item, index (index)}
            <li><span class="tapet-map-swatch" style:background={item.color}></span>{item.label}</li>
          {/each}
        </ul>
      </div>
    {:else if scale}
      <div class="tapet-map-legend">
        <span class="tapet-map-key">{scale.field}</span>
        <span class="tapet-map-ramp" style:background={scale.gradient}></span>
        <span class="tapet-map-range"><span>{scale.low}</span><span>{scale.high}</span></span>
      </div>
    {/if}
    <span class="tapet-map-count">
      {count === 0 ? 'No data yet' : `${count.toLocaleString()} ${count === 1 ? 'feature' : 'features'}`}
      {#if loading}· loading the base map…{/if}
    </span>
  </div>
</div>
