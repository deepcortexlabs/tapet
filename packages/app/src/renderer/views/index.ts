import type { ViewType } from '@tapet/core'
import { mount, unmount, type Component } from 'svelte'
import type { Bridge, MountedView, ViewMount } from '../bridge.ts'
import ChartView from './chart/ChartView.svelte'
import CustomView from './custom/CustomView.svelte'
import DocumentView from './document/DocumentView.svelte'
import GaugeView from './gauge/GaugeView.svelte'
import LogView from './log/LogView.svelte'
import TableView from './table/TableView.svelte'

type ViewComponent = Component<{ bridge: Bridge }>

// Views whose libraries are large load with the first panel that uses them, rather than with
// every window.
function lazyView(load: () => Promise<{ default: ViewComponent }>): ViewMount {
  return (target, bridge) => {
    let mounted: ReturnType<typeof mount> | undefined
    let destroyed = false
    load()
      .then(({ default: component }) => {
        if (!destroyed) {
          mounted = mount(component, { target, props: { bridge } })
        }
      })
      .catch((error: unknown) => {
        bridge.reportError(
          `couldn't load the view: ${error instanceof Error ? error.message : String(error)}`,
        )
      })
    return {
      destroy: () => {
        destroyed = true
        if (mounted) {
          void unmount(mounted)
        }
      },
    }
  }
}

function svelteView(component: ViewComponent): ViewMount {
  return (target, bridge) => {
    // A component may export settled(), see MountedView.
    const mounted = mount(component, { target, props: { bridge } }) as {
      settled?: () => Promise<string | undefined>
    }
    return {
      destroy: () => {
        void unmount(mounted)
      },
      settled: () => mounted.settled?.() ?? Promise.resolve(undefined),
    }
  }
}

const VIEWS: Partial<Record<ViewType, ViewMount>> = {
  log: svelteView(LogView),
  table: svelteView(TableView),
  chart: svelteView(ChartView),
  graph: lazyView(() => import('./graph/GraphView.svelte')),
  map: lazyView(() => import('./map/MapView.svelte')),
  custom: svelteView(CustomView),
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
