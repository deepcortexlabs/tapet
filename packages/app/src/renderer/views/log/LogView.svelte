<script lang="ts">
  import { AnsiUp } from 'ansi_up'
  import { followsNewest } from '@tapet/core'
  import { onDestroy, tick, untrack } from 'svelte'
  import type { Bridge } from '../../bridge.ts'
  import { createLogModel } from './log-model.ts'

  let props: { bridge: Bridge } = $props()
  // A view keeps its bridge for life; tapet remounts the view to change it.
  const bridge = untrack(() => props.bridge)

  // Fixed row height keeps the list virtual: only rows near the viewport are in the DOM.
  const ROW = 18
  const OVERSCAN = 30
  const ansi = new AnsiUp()
  const model = createLogModel(bridge.entries())

  let version = $state(0)
  let query = $state('')
  let scrollTop = $state(0)
  let height = $state(0)
  let followEnabled = $state(followsNewest(bridge.settings()))
  let following = $state(true)
  let viewport: HTMLDivElement | undefined = $state()

  const count = $derived.by(() => {
    void version
    return model.lines.length
  })
  const total = $derived.by(() => {
    void version
    return model.total
  })
  const rows = $derived.by(() => {
    void version
    const first = Math.max(0, Math.floor(scrollTop / ROW) - OVERSCAN)
    const last = Math.min(count, Math.ceil((scrollTop + height) / ROW) + OVERSCAN)
    return model.lines.slice(first, last).map((line, index) => ({ line, top: (first + index) * ROW }))
  })

  // Converts one line on its own: the trailing reset keeps colors from leaking into the next line.
  function render(text: string): string {
    return ansi.ansi_to_html(`${text}\u001b[0m`)
  }

  async function stickToBottom() {
    if (!followEnabled || !following || !viewport) {
      return
    }

    await tick()
    viewport.scrollTop = viewport.scrollHeight
  }

  const stopChanges = bridge.onChange((change) => {
    model.apply(change)
    version += 1
    void stickToBottom()
  })

  const stopSettings = bridge.onSettings((settings) => {
    followEnabled = followsNewest(settings)
    following = true
    void stickToBottom()
  })

  onDestroy(() => {
    stopChanges()
    stopSettings()
  })

  $effect(() => {
    if (viewport) {
      void stickToBottom()
    }
  })

  function onScroll() {
    if (!viewport) {
      return
    }

    scrollTop = viewport.scrollTop
    following = viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - ROW
  }

  function onSearch() {
    model.search(query)
    version += 1
    void stickToBottom()
  }

  function jumpToLatest() {
    following = true
    void stickToBottom()
  }
</script>

<div class="tapet-log">
  <div class="tapet-log-bar">
    <input class="tapet-log-search" type="search" placeholder="Search" bind:value={query} oninput={onSearch} />
    <span class="tapet-log-count">{query ? `${count} of ${total} lines` : `${total} lines`}</span>
    {#if followEnabled && !following}
      <button class="tapet-log-jump" onclick={jumpToLatest}>Jump to latest</button>
    {/if}
  </div>
  <div class="tapet-log-lines" bind:this={viewport} bind:clientHeight={height} onscroll={onScroll}>
    <div class="tapet-log-content" style:height="{count * ROW}px">
      {#each rows as row (row.line.key)}
        <div class="tapet-log-line" style:top="{row.top}px">{@html render(row.line.text)}</div>
      {/each}
    </div>
  </div>
</div>
