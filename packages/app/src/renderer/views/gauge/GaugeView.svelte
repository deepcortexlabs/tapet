<script lang="ts">
  import type { Entry } from '@tapet/core'
  import { onDestroy, untrack } from 'svelte'
  import type { Bridge } from '../../bridge.ts'
  import { formatNumber, readGauge } from './gauge-model.ts'

  let props: { bridge: Bridge } = $props()
  // A view keeps its bridge for life; tapet remounts the view to change it.
  const bridge = untrack(() => props.bridge)

  // A dial is an arc from min (left) to max (right); the fill covers the value's share of it.
  const ARC = 'M 10 62 A 50 50 0 0 1 110 62'

  let latest = $state.raw<Entry | undefined>(bridge.entries().at(-1))
  let settings = $state.raw(bridge.settings().gauge ?? {})

  const reading = $derived(latest ? readGauge(latest.value, settings) : { kind: 'empty' as const })
  const style = $derived(settings.style ?? 'number')
  const unit = $derived(settings.unit ?? '')
  const min = $derived(settings.min ?? 0)
  const max = $derived(settings.max ?? 0)

  $effect(() => {
    if (reading.kind === 'error') {
      bridge.reportError(reading.message)
    }
  })

  const stopChanges = bridge.onChange(() => {
    latest = bridge.entries().at(-1)
  })

  const stopSettings = bridge.onSettings((next) => {
    settings = next.gauge ?? {}
  })

  onDestroy(() => {
    stopChanges()
    stopSettings()
  })
</script>

<div class="tapet-gauge" data-style={style}>
  {#if reading.kind === 'empty'}
    <p class="tapet-empty">No value yet</p>
  {:else if reading.kind === 'error'}
    <p class="tapet-gauge-error">{reading.message}</p>
  {:else if reading.kind === 'text'}
    <div class="tapet-gauge-value">{reading.text}</div>
  {:else if style === 'dial'}
    <svg
      class="tapet-gauge-dial"
      viewBox="0 0 120 74"
      role="meter"
      aria-valuenow={reading.value}
      aria-valuemin={min}
      aria-valuemax={max}
    >
      <path class="tapet-gauge-track" d={ARC} pathLength="1" />
      <path
        class="tapet-gauge-fill"
        d={ARC}
        pathLength="1"
        stroke-dasharray="{reading.fraction} 1"
        style:stroke={reading.color}
      />
      <text class="tapet-gauge-dial-value" x="60" y="58" style:fill={reading.color}>
        {reading.text}<tspan class="tapet-gauge-unit">{unit}</tspan>
      </text>
      <text class="tapet-gauge-limit" x="10" y="73">{formatNumber(min)}</text>
      <text class="tapet-gauge-limit" x="110" y="73">{formatNumber(max)}</text>
    </svg>
  {:else if style === 'bar'}
    <div class="tapet-gauge-value" style:color={reading.color}>
      {reading.text}<span class="tapet-gauge-unit">{unit}</span>
    </div>
    <div class="tapet-gauge-bar" role="meter" aria-valuenow={reading.value} aria-valuemin={min} aria-valuemax={max}>
      <div class="tapet-gauge-bar-fill" style:width="{reading.fraction * 100}%" style:background={reading.color}></div>
    </div>
    <div class="tapet-gauge-limits">
      <span>{formatNumber(min)}</span>
      <span>{formatNumber(max)}</span>
    </div>
  {:else}
    <div class="tapet-gauge-value" style:color={reading.color}>
      {reading.text}<span class="tapet-gauge-unit">{unit}</span>
    </div>
  {/if}
</div>
