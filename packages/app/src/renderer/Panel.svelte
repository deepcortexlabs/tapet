<script lang="ts">
  import type { ViewType } from '@tapet/core'
  import type { MountedView } from './bridge.ts'
  import { client, type PanelState } from './client.svelte.ts'
  import { renderMarkdown } from './markdown.ts'
  import { mountView } from './views/index.ts'

  let { panel }: { panel: PanelState } = $props()
  let target: HTMLDivElement | undefined = $state()
  let failure = $state<string>()
  let mounted: { type: ViewType; view?: MountedView } | undefined
  // live: a pipe is feeding the panel; idle: none is; ended: the session ended.
  const liveness = $derived(client.state === 'ended' ? 'ended' : panel.live ? 'live' : 'idle')

  // The panel's own CSS applies only inside the panel.
  const style = document.createElement('style')
  document.head.append(style)

  $effect(() => {
    const { css } = panel.settings
    style.textContent = css ? `@scope ([data-panel="${panel.id}"]) {\n${css}\n}` : ''
  })

  // Mounts the view, remounting only when the view type changes, then confirms the render.
  $effect(() => {
    const { view } = panel.settings
    if (!target) {
      return
    }

    if (mounted?.type !== view) {
      mounted?.view?.destroy()
      const result = mountView(view, target, panel.data.bridge)
      failure = 'error' in result ? result.error : undefined
      mounted = 'error' in result ? { type: view } : { type: view, view: result.view }
    }

    // Views that draw asynchronously report their error once they've drawn.
    const error = failure
    const shown = mounted.view
    requestAnimationFrame(() => {
      void (shown?.settled?.() ?? Promise.resolve(undefined)).then((late) =>
        client.rendered(panel.id, error ?? late),
      )
    })
  })

  $effect(() => () => {
    mounted?.view?.destroy()
    style.remove()
  })
</script>

<section class="tapet-panel" data-panel={panel.id}>
  <header class="tapet-title">
    <span class="tapet-dot" data-state={liveness} title={liveness}></span>
    <span class="tapet-title-text">{panel.settings.title}</span>
    {#if panel.smart && panel.smart.status !== 'idle'}
      <span class="tapet-smart-status" data-status={panel.smart.status}>{panel.smart.status}</span>
    {/if}
  </header>
  {#if panel.smart?.latest}
    <div class="tapet-smart-output">
      {#if panel.smart.latest.error}
        <p class="tapet-smart-error">{panel.smart.latest.error}</p>
      {:else}
        {@html renderMarkdown(panel.smart.latest.text ?? '')}
      {/if}
    </div>
  {/if}
  <div class="tapet-body">
    <div class="tapet-view" bind:this={target}></div>
    {#if failure}
      <div class="tapet-error">{failure}</div>
    {/if}
  </div>
</section>
