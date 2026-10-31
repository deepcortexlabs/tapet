import type { ViewType } from '@tapet/core'
import { mount, unmount, type Component } from 'svelte'
import type { Bridge, MountedView, ViewMount } from '../bridge.ts'
import DocumentView from './document/DocumentView.svelte'
import GaugeView from './gauge/GaugeView.svelte'
import LogView from './log/LogView.svelte'
import TableView from './table/TableView.svelte'

function svelteView(component: Component<{ bridge: Bridge }>): ViewMount {
  return (target, bridge) => {
    const mounted = mount(component, { target, props: { bridge } })
    return {
      destroy: () => {
        void unmount(mounted)
      },
    }
  }
}

const VIEWS: Partial<Record<ViewType, ViewMount>> = {
  log: svelteView(LogView),
  table: svelteView(TableView),
  document: svelteView(DocumentView),
  gauge: svelteView(GaugeView),
}

export function mountView(
  type: ViewType,
  target: HTMLElement,
  bridge: Bridge,
): { view: MountedView } | { error: string } {
  const mount = VIEWS[type]
  if (!mount) {
    return { error: `the ${type} view isn't available in this version of tapet yet` }
  }

  try {
    return { view: mount(target, bridge) }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}
