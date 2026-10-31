import type { Change, Entry, EntryKey, PanelSettings } from '@tapet/core'

// What a view gets: the panel's settings and data, then live changes. Custom views will get the same.
export interface Bridge {
  settings(): PanelSettings
  entries(): Entry[]
  onChange(listener: (change: Change) => void): () => void
  onSettings(listener: (settings: PanelSettings) => void): () => void
  // Tells the agent about a problem the view found, e.g. data it can't show. A message that
  // repeats the previous one isn't sent again.
  reportError(message: string): void
}

export interface MountedView {
  destroy(): void
}

export type ViewMount = (target: HTMLElement, bridge: Bridge) => MountedView

export interface PanelData {
  bridge: Bridge
  apply(change: Change): void
  update(settings: PanelSettings): void
}

// A panel's settings and data in the window, kept in step with the session process.
export function createPanelData(
  settings: PanelSettings,
  entries: Entry[],
  report: (message: string) => void,
): PanelData {
  let current = settings
  let reported: string | undefined
  const byKey = new Map<EntryKey, Entry>(entries.map((entry) => [entry.key, entry]))
  const changeListeners = new Set<(change: Change) => void>()
  const settingsListeners = new Set<(settings: PanelSettings) => void>()

  return {
    bridge: {
      settings: () => current,
      entries: () => [...byKey.values()],
      onChange(listener) {
        changeListeners.add(listener)
        return () => {
          changeListeners.delete(listener)
        }
      },
      onSettings(listener) {
        settingsListeners.add(listener)
        return () => {
          settingsListeners.delete(listener)
        }
      },
      reportError(message) {
        if (message === reported) {
          return
        }

        reported = message
        report(message)
      },
    },

    apply(change) {
      for (const key of change.removed) {
        byKey.delete(key)
      }

      for (const entry of [...change.updated, ...change.added]) {
        byKey.set(entry.key, entry)
      }

      for (const listener of changeListeners) {
        listener(change)
      }
    },

    update(next) {
      current = next
      for (const listener of settingsListeners) {
        listener(next)
      }
    },
  }
}
