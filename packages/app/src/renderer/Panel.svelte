<script lang="ts">
  import type { ViewType } from '@tapet/core'
  import { tick } from 'svelte'
  import type { MountedView } from './bridge.ts'
  import { client, type PanelState } from './client.svelte.ts'
  import { fade, holdPlace, moveFrom, moveTo, type Hold } from './expand.ts'
  import { renderMarkdown } from './markdown.ts'
  import { mountView } from './views/index.ts'

  let { panel }: { panel: PanelState } = $props()
  let target: HTMLDivElement | undefined = $state()
  let failure = $state<string>()
  let mounted: { type: ViewType; view?: MountedView } | undefined
  // live: a pipe is feeding the panel; idle: none is; ended: the session ended.
  const liveness = $derived(client.state === 'ended' ? 'ended' : panel.live ? 'live' : 'idle')

  // A double-click on the title bar expands the panel over most of the window. The placeholder's
  // style keeps the panel's place in the agent's layout while it's out; see expand.ts.
  let section: HTMLElement | undefined = $state()
  let placeholder: HTMLDivElement | undefined = $state()
  let backdrop: HTMLButtonElement | undefined = $state()
  let slot = $state<string>()
  let expanded = $state(false)
  let hold: Hold | undefined
  // Where the panel was when it expanded, for panels whose placeholder takes no room.
  let origin: DOMRect | undefined
  let moving = false

  // While a panel is expanded, the others can't be reached, by mouse or by keyboard.
  function setOthersInert(inert: boolean) {
    for (const other of document.querySelectorAll<HTMLElement>('#tapet > [data-panel]')) {
      if (other !== section) {
        other.inert = inert
      }
    }
  }

  async function expand() {
    if (!section || expanded || moving) {
      return
    }

    moving = true
    origin = section.getBoundingClientRect()
    hold = holdPlace(section)
    slot = hold.style
    expanded = true
    setOthersInert(true)
    await tick()
    fade(backdrop, 'in')
    await moveFrom(section, origin, section.getBoundingClientRect())
    moving = false
  }

  async function collapse() {
    if (!section || !expanded || moving) {
      return
    }

    moving = true
    const target = placeholder?.getBoundingClientRect()
    const back = target && target.width > 0 && target.height > 0 ? target : origin
    fade(backdrop, 'out')
    const animation = back ? moveTo(section, section.getBoundingClientRect(), back) : undefined
    await animation?.finished
    expanded = false
    slot = undefined
    setOthersInert(false)
    await tick()
    hold?.release()
    hold = undefined
    // The panel is back in its place before the held transform goes, so it never shows elsewhere.
    animation?.cancel()
    moving = false
  }

  function toggle() {
    void (expanded ? collapse() : expand())
  }

  function onKeydown(event: KeyboardEvent) {
    if (expanded && event.key === 'Escape') {
      void collapse()
    }
  }

  // A double-click would also select the title's text.
  function onTitleMousedown(event: MouseEvent) {
    if (event.detail > 1) {
      event.preventDefault()
    }
  }

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
    if (expanded) {
      setOthersInert(false)
      hold?.release()
    }
  })
</script>

<svelte:window onkeydown={onKeydown} />

{#if slot !== undefined}
  <div class="tapet-placeholder" style={slot} bind:this={placeholder}>
    <button
      class="tapet-backdrop"
      aria-label="Put the panel back"
      onclick={collapse}
      bind:this={backdrop}
    ></button>
  </div>
{/if}
<section
  class="tapet-panel"
  class:tapet-expanded={expanded}
  data-panel={panel.id}
  bind:this={section}
>
  <!-- The title bar's double-click is a shortcut; Escape and the backdrop put the panel back. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <header class="tapet-title" ondblclick={toggle} onmousedown={onTitleMousedown}>
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
