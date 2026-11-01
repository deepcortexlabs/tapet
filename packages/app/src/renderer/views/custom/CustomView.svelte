<script lang="ts">
  import { onDestroy, untrack } from 'svelte'
  import type { Bridge } from '../../bridge.ts'
  import { onThemeChange } from '../theme.ts'

  let props: { bridge: Bridge } = $props()
  // A view keeps its bridge for life; tapet remounts the view to change it.
  const bridge = untrack(() => props.bridge)

  // The theme variables the frame gets, since the window's CSS doesn't reach into it.
  const THEME = [
    'bg',
    'fg',
    'muted',
    'border',
    'panel-bg',
    'accent',
    'font',
    'mono',
    'grid',
    'axis',
    ...Array.from({ length: 8 }, (_, index) => `series-${index + 1}`),
  ].map((name) => `--tapet-${name}`)

  let frame: HTMLIFrameElement | undefined = $state()
  let error = $state<string>()
  // A new frame for new code: the page reloads and runs the code from scratch.
  let generation = $state(0)
  let code = JSON.stringify([bridge.settings().custom?.code, bridge.settings().custom?.surface])
  let initialized = false
  let finish: (error?: string) => void = () => undefined
  let run = Promise.resolve<string | undefined>(undefined)

  function expectRun() {
    run = new Promise((resolve) => {
      finish = resolve
    })
  }

  expectRun()

  // The error of the latest code's first run, if it threw; see MountedView.
  export function settled(): Promise<string | undefined> {
    return run
  }

  function theme(): Record<string, string> {
    const style = getComputedStyle(frame ?? document.documentElement)
    return Object.fromEntries(THEME.map((name) => [name, style.getPropertyValue(name).trim()]))
  }

  function send(message: unknown) {
    frame?.contentWindow?.postMessage(message, '*')
  }

  function onMessage(event: MessageEvent<{ type: string; message?: string }>) {
    if (!frame || event.source !== frame.contentWindow) {
      return
    }

    const message = event.data
    if (message.type === 'ready') {
      const settings = bridge.settings()
      initialized = true
      send({
        type: 'init',
        code: settings.custom?.code ?? '',
        surface: settings.custom?.surface ?? 'dom',
        settings,
        entries: bridge.entries(),
        theme: theme(),
      })
      return
    }

    if (message.type === 'ran') {
      finish()
      return
    }

    if (message.type === 'error') {
      error = message.message
      bridge.reportError(message.message ?? 'the custom code failed')
      finish(message.message)
    }
  }

  addEventListener('message', onMessage)
  const stopChanges = bridge.onChange((change) => {
    if (initialized) {
      send({ type: 'change', change })
    }
  })
  const stopSettings = bridge.onSettings((settings) => {
    const next = JSON.stringify([settings.custom?.code, settings.custom?.surface])
    if (next === code) {
      send({ type: 'settings', settings })
      return
    }

    code = next
    initialized = false
    error = undefined
    expectRun()
    generation += 1
  })
  const stopTheme = onThemeChange(() => send({ type: 'theme', theme: theme() }))

  onDestroy(() => {
    removeEventListener('message', onMessage)
    stopChanges()
    stopSettings()
    stopTheme()
  })
</script>

<div class="tapet-custom">
  {#key generation}
    <iframe
      class="tapet-custom-frame"
      title="custom view"
      sandbox="allow-scripts"
      src="./custom.html"
      bind:this={frame}
    ></iframe>
  {/key}
  {#if error}
    <p class="tapet-custom-error">{error}</p>
  {/if}
</div>
