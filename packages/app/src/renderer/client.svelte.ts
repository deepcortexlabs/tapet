// The window's side of the session: applies what the session sends and answers its requests.
import type { PanelSettings, WindowSettings } from '@tapet/core'
import type {
  Geometry,
  PanelSnapshot,
  SessionToWindow,
  WindowToSession,
} from '@tapet/protocol/messages'
import { createPanelData, type PanelData } from './bridge.ts'

export interface PanelState {
  id: string
  settings: PanelSettings
  data: PanelData
}

function toState({ settings, entries }: PanelSnapshot): PanelState {
  return { id: settings.id, settings, data: createPanelData(settings, entries) }
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

  #send(message: WindowToSession) {
    this.#port?.postMessage(message)
  }

  #handle(message: SessionToWindow) {
    if (message.type === 'snapshot') {
      this.window = message.window
      this.frozen = message.frozen
      this.panels = message.panels.map(toState)
      return
    }

    if (message.type === 'window') {
      this.window = message.window
      return
    }

    if (message.type === 'panelAdded') {
      this.panels = [...this.panels, toState(message.panel)]
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

    this.#send({ type: 'geometry', requestId: message.requestId, geometry: measure() })
  }
}

export const client = new Client()
