<script lang="ts">
  import type { Entry } from '@tapet/core'
  import { onDestroy, untrack } from 'svelte'
  import type { Bridge } from '../../bridge.ts'
  import DocumentItem from './DocumentItem.svelte'

  let props: { bridge: Bridge } = $props()
  // A view keeps its bridge for life; tapet remounts the view to change it.
  const bridge = untrack(() => props.bridge)

  // replace panels hold the latest document; append panels hold several, shown in order.
  let entries = $state.raw<Entry[]>(bridge.entries())
  let content = $state(bridge.settings().document?.content ?? 'markdown')

  const stopChanges = bridge.onChange(() => {
    entries = bridge.entries()
  })

  const stopSettings = bridge.onSettings((settings) => {
    content = settings.document?.content ?? 'markdown'
  })

  onDestroy(() => {
    stopChanges()
    stopSettings()
  })
</script>

<div class="tapet-document">
  {#each entries as entry (`${entry.key}:${entry.seq}`)}
    <DocumentItem {entry} {content} report={bridge.reportError} />
  {:else}
    <p class="tapet-empty">No document yet</p>
  {/each}
</div>
