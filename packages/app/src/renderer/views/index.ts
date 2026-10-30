import type { ViewType } from '@tapet/core'
import type { Bridge, MountedView, ViewMount } from '../bridge.ts'
import { mountLog } from './log/index.ts'

const VIEWS: Partial<Record<ViewType, ViewMount>> = { log: mountLog }

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
