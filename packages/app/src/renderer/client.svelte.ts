// The window's side of the session: applies what the session sends and answers its requests.
import type { PanelSettings, WindowSettings } from '@tapet/core'
import type {
  Geometry,
  PanelSnapshot,
  SessionToWindow,
  SmartView,
  WindowToSession,
} from '@tapet/protocol/messages'
import { createPanelData, type PanelData } from './bridge.ts'

export interface PanelState {
  id: string
  settings: PanelSettings
  data: PanelData
  // Whether a pipe is feeding the panel right now.
  live: boolean
  smart?: SmartView
}

function toState(
  { settings, entries, live, smart }: PanelSnapshot,
  report: (message: string, panel: string) => void,
): PanelState {
  const data = createPanelData(settings, entries, (message) => report(message, settings.id))
  const state = { id: settings.id, settings, data, live }
  return smart ? { ...state, smart } : state
}

function measure(): Geometry {
  const panels = [...document.querySelectorAll<HTMLElement>('#tapet > [data-panel]')].map(
    (element) => {
      const rect = element.getBoundingClientRect()
      return {
        id: element.dataset.panel ?? '',
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        overflow:
          element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight,
        zeroSize: rect.width === 0 || rect.height === 0,
      }
    },
  )
  return { window: { width: window.innerWidth, height: window.innerHeight }, panels }
}

class Client {
  window = $state<WindowSettings>({})
  frozen = $state(false)
  panels = $state.raw<PanelState[]>([])
  #port: MessagePort | undefined

  connect(port: MessagePort) {
    this.#port = port
    port.onmessage = (event: MessageEvent<SessionToWindow>) => this.#handle(event.data)
  }

  rendered(panel: string, error?: string) {
    this.#send(error ? { type: 'rendered', panel, error } : { type: 'rendered', panel })
  }

  error(message: string, panel?: string) {
    this.#send(panel ? { type: 'error', panel, message } : { type: 'error', message })
  }

  #report = (message: string, panel: string) => this.error(message, panel)

  #replace(id: string, change: (panel: PanelState) => PanelState) {
    this.panels = this.panels.map((panel) => (panel.id === id ? change(panel) : panel))
  }

  #send(message: WindowToSession) {
    this.#port?.postMessage(message)
  }

  #handle(message: SessionToWindow) {
    if (message.type === 'snapshot') {
      this.window = message.window
      this.frozen = message.frozen
      this.panels = message.panels.map((panel) => toState(panel, this.#report))
      return
    }

    if (message.type === 'window') {
      this.window = message.window
      return
    }

    if (message.type === 'panelAdded') {
      this.panels = [...this.panels, toState(message.panel, this.#report)]
      return
    }

    if (message.type === 'panelUpdated') {
      const { settings } = message
      this.panels.find((panel) => panel.id === settings.id)?.data.update(settings)
      this.panels = this.panels.map((panel) =>
        panel.id === settings.id ? { ...panel, settings } : panel,
      )
      return
    }

    if (message.type === 'panelRemoved') {
      this.panels = this.panels.filter((panel) => panel.id !== message.id)
      return
    }

    if (message.type === 'changes') {
      for (const [id, changes] of Object.entries(message.panels)) {
        const panel = this.panels.find((candidate) => candidate.id === id)
        for (const change of changes) {
          panel?.data.apply(change)
        }
      }

      return
    }

    if (message.type === 'frozen') {
      this.frozen = message.frozen
      return
    }

    if (message.type === 'panelLive') {
      this.#replace(message.panel, (panel) => ({ ...panel, live: message.live }))
      return
    }

    if (message.type === 'smart') {
      this.#replace(message.panel, (panel) => ({ ...panel, smart: message.smart }))
      return
    }

    this.#send({ type: 'geometry', requestId: message.requestId, geometry: measure() })
  }
}

export const client = new Client()
