<script lang="ts">
  import type { ViewType } from '@tapet/core'
  import type { MountedView } from './bridge.ts'
  import { client, type PanelState } from './client.svelte.ts'
  import { mountView } from './views/index.ts'

  let { panel }: { panel: PanelState } = $props()
  let target: HTMLDivElement | undefined = $state()
  let failure = $state<string>()
  let mounted: { type: ViewType; view?: MountedView } | undefined

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

    const error = failure
    requestAnimationFrame(() => client.rendered(panel.id, error))
  })

  $effect(() => () => {
    mounted?.view?.destroy()
    style.remove()
  })
</script>

<section class="tapet-panel" data-panel={panel.id}>
  <header class="tapet-title">{panel.settings.title}</header>
  <div class="tapet-body">
    <div class="tapet-view" bind:this={target}></div>
    {#if failure}
      <div class="tapet-error">{failure}</div>
    {/if}
  </div>
</section>
