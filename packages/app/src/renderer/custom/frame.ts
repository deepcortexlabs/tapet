// Runs inside a custom view's sandboxed frame; the build inlines it into custom.html. It gives the
// agent's code the tapet object and carries messages to and from the panel. The frame has no
// origin of its own, so the code can't reach tapet's window or the session.
;(() => {
  type Key = string | number

  interface Entry {
    key: Key
    seq: number
    receivedAt: number
    value: unknown
  }

  interface Change {
    added: Entry[]
    updated: Entry[]
    removed: Key[]
  }

  interface Size {
    width: number
    height: number
    pixelRatio: number
  }

  type Inbound =
    | {
        type: 'init'
        code: string
        surface: 'dom' | 'canvas2d' | 'webgl'
        settings: unknown
        entries: Entry[]
        theme: Record<string, string>
      }
    | { type: 'change'; change: Change }
    | { type: 'settings'; settings: unknown }
    | { type: 'theme'; theme: Record<string, string> }

  type Outbound = { type: 'ready' } | { type: 'ran' } | { type: 'error'; message: string }

  const byKey = new Map<Key, Entry>()
  const changeListeners = new Set<(change: Change) => void>()
  const settingsListeners = new Set<(settings: unknown) => void>()
  const resizeListeners = new Set<(size: Size) => void>()
  let current: unknown
  let started = false

  function post(message: Outbound) {
    parent.postMessage(message, '*')
  }

  function report(error: unknown) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }

  function subscribe<T>(listeners: Set<T>, listener: T): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  function size(): Size {
    return { width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio }
  }

  function applyTheme(theme: Record<string, string>) {
    for (const [name, value] of Object.entries(theme)) {
      document.documentElement.style.setProperty(name, value)
    }
  }

  async function start(message: Extract<Inbound, { type: 'init' }>) {
    started = true
    applyTheme(message.theme)
    current = message.settings
    for (const entry of message.entries) {
      byKey.set(entry.key, entry)
    }

    const root = document.createElement('div')
    root.id = 'root'
    document.body.append(root)
    const tapet: Record<string, unknown> = {
      root,
      entries: () => [...byKey.values()],
      onChange: (listener: (change: Change) => void) => subscribe(changeListeners, listener),
      settings: () => current,
      onSettings: (listener: (settings: unknown) => void) => subscribe(settingsListeners, listener),
      size,
      onResize: (listener: (size: Size) => void) => subscribe(resizeListeners, listener),
    }

    // Canvas surfaces fill the frame in device pixels, and follow its size.
    if (message.surface !== 'dom') {
      const canvas = document.createElement('canvas')
      const fit = () => {
        canvas.width = Math.round(innerWidth * devicePixelRatio)
        canvas.height = Math.round(innerHeight * devicePixelRatio)
      }
      fit()
      addEventListener('resize', fit)
      root.append(canvas)
      tapet.canvas = canvas
      if (message.surface === 'webgl') {
        const gl = canvas.getContext('webgl2')
        if (!gl) {
          report(new Error("WebGL 2 isn't available in this window"))
          return
        }

        tapet.gl = gl
      }
    }

    Object.assign(globalThis, { tapet })
    // A module, so the code can import packages from the allowed hosts.
    const url = URL.createObjectURL(new Blob([message.code], { type: 'text/javascript' }))
    try {
      await import(url)
      post({ type: 'ran' })
    } catch (error) {
      report(error)
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  addEventListener('error', (event) => report(event.error ?? event.message))
  addEventListener('unhandledrejection', (event) => report(event.reason))
  addEventListener('resize', () => {
    for (const listener of resizeListeners) {
      listener(size())
    }
  })

  addEventListener('message', (event: MessageEvent<Inbound>) => {
    if (event.source !== parent) {
      return
    }

    const message = event.data
    if (message.type === 'init') {
      if (!started) {
        void start(message)
      }

      return
    }

    if (message.type === 'change') {
      for (const key of message.change.removed) {
        byKey.delete(key)
      }

      for (const entry of [...message.change.updated, ...message.change.added]) {
        byKey.set(entry.key, entry)
      }

      for (const listener of changeListeners) {
        listener(message.change)
      }

      return
    }

    if (message.type === 'settings') {
      current = message.settings
      for (const listener of settingsListeners) {
        listener(current)
      }

      return
    }

    applyTheme(message.theme)
  })

  post({ type: 'ready' })
})()
