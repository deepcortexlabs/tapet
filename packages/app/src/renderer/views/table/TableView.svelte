<script lang="ts">
  import { followsNewest } from '@tapet/core'
  import { onDestroy, tick, untrack } from 'svelte'
  import type { Bridge } from '../../bridge.ts'
  import { createTableModel } from './table-model.ts'

  let props: { bridge: Bridge } = $props()
  // A view keeps its bridge for life; tapet remounts the view to change it.
  const bridge = untrack(() => props.bridge)

  // Fixed row height keeps the table virtual: only rows near the viewport are in the DOM.
  const ROW = 24
  const OVERSCAN = 20
  // Room for each cell's padding, in characters.
  const PADDING = 2
  const model = createTableModel(bridge.entries(), bridge.settings().table?.columns)
  let columnsSetting = JSON.stringify(bridge.settings().table?.columns)

  let version = $state(0)
  let scrollTop = $state(0)
  let height = $state(0)
  let headerHeight = $state(0)
  let followEnabled = $state(followsNewest(bridge.settings()))
  let following = $state(true)
  let viewport: HTMLDivElement | undefined = $state()

  const table = $derived.by(() => {
    void version
    return { columns: model.columns, widths: model.widths, rows: model.rows, sorting: model.sorting }
  })
  // The last column takes the remaining width. Agent CSS can override grid-template-columns.
  const template = $derived(
    table.widths
      .map((width, index) =>
        index === table.widths.length - 1 ? `minmax(${width + PADDING}ch, 1fr)` : `${width + PADDING}ch`,
      )
      .join(' '),
  )
  const width = $derived(table.widths.reduce((sum, columnWidth) => sum + columnWidth + PADDING, 0))
  const visible = $derived.by(() => {
    // Rows start below the sticky header.
    const top = Math.max(0, scrollTop - headerHeight)
    const first = Math.max(0, Math.floor(top / ROW) - OVERSCAN)
    const last = Math.min(table.rows.length, Math.ceil((top + height) / ROW) + OVERSCAN)
    return table.rows.slice(first, last).map((row, index) => ({ row, top: (first + index) * ROW }))
  })

  // New rows arrive at the bottom, unless the user sorted the table.
  async function stickToBottom() {
    if (!followEnabled || !following || model.sorting || !viewport) {
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
    const columns = JSON.stringify(settings.table?.columns)
    if (columns !== columnsSetting) {
      columnsSetting = columns
      model.setColumns(settings.table?.columns)
      version += 1
    }

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

  function sortBy(column: number) {
    model.sort(column)
    version += 1
    void stickToBottom()
  }

  function ariaSort(column: number) {
    if (table.sorting?.column !== column) {
      return 'none'
    }

    return table.sorting.descending ? 'descending' : 'ascending'
  }

  function jumpToLatest() {
    following = true
    void stickToBottom()
  }
</script>

<div class="tapet-table" role="table" style:--tapet-table-columns={template}>
  <div class="tapet-table-scroll" bind:this={viewport} bind:clientHeight={height} onscroll={onScroll}>
    <div class="tapet-table-content" style:width="max(100%, {width}ch)">
      <div class="tapet-table-header" role="row" bind:clientHeight={headerHeight}>
        {#each table.columns as column, index (index)}
          <div class="tapet-table-heading" role="columnheader" aria-sort={ariaSort(index)}>
            <button onclick={() => sortBy(index)} title="Sort by {column}">
              {column}
              {#if table.sorting?.column === index}
                <span class="tapet-table-arrow">{table.sorting.descending ? '▼' : '▲'}</span>
              {/if}
            </button>
          </div>
        {/each}
      </div>
      <div class="tapet-table-body" style:height="{table.rows.length * ROW}px">
        {#each visible as { row, top } (row.key)}
          <div class="tapet-table-row" role="row" style:top="{top}px">
            {#each table.columns as _, index (index)}
              {@const text = model.cell(row, index)}
              <div class="tapet-table-cell" role="cell" title={text}>{text}</div>
            {/each}
          </div>
        {/each}
      </div>
    </div>
  </div>
  {#if table.rows.length === 0}
    <p class="tapet-empty tapet-table-empty">No rows yet</p>
  {/if}
  {#if followEnabled && !following && !table.sorting}
    <button class="tapet-jump" onclick={jumpToLatest}>Jump to latest</button>
  {/if}
</div>
