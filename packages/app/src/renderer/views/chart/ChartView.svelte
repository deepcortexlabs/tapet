<script lang="ts">
  import { onDestroy, untrack } from 'svelte'
  import type { Bridge } from '../../bridge.ts'
  import UplotChart from './UplotChart.svelte'

  let props: { bridge: Bridge } = $props()
  // A view keeps its bridge for life; tapet remounts the view to change it.
  const bridge = untrack(() => props.bridge)

  let engine = $state(bridge.settings().chart?.engine ?? 'uplot')
  const stopSettings = bridge.onSettings((settings) => {
    engine = settings.chart?.engine ?? 'uplot'
  })

  onDestroy(stopSettings)

  // Vega-Lite is large, so it loads with the first chart that uses it rather than with every window.
  const loadVega = () => import('./VegaChart.svelte')
</script>

{#if engine === 'vega-lite'}
  {#await loadVega() then { default: VegaChart }}
    <VegaChart {bridge} />
  {:catch error}
    <p class="tapet-chart-error tapet-chart-message">couldn't load Vega-Lite: {String(error)}</p>
  {/await}
{:else}
  <UplotChart {bridge} />
{/if}
