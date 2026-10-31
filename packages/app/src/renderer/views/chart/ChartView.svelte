<script lang="ts">
  import { onDestroy, untrack } from 'svelte'
  import type { Bridge } from '../../bridge.ts'
  import UplotChart from './UplotChart.svelte'
  import VegaChart from './VegaChart.svelte'

  let props: { bridge: Bridge } = $props()
  // A view keeps its bridge for life; tapet remounts the view to change it.
  const bridge = untrack(() => props.bridge)

  let engine = $state(bridge.settings().chart?.engine ?? 'uplot')
  const stopSettings = bridge.onSettings((settings) => {
    engine = settings.chart?.engine ?? 'uplot'
  })

  onDestroy(stopSettings)
</script>

{#if engine === 'vega-lite'}
  <VegaChart {bridge} />
{:else}
  <UplotChart {bridge} />
{/if}
