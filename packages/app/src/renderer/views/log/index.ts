import { mount, unmount } from 'svelte'
import type { ViewMount } from '../../bridge.ts'
import LogView from './LogView.svelte'

export const mountLog: ViewMount = (target, bridge) => {
  const component = mount(LogView, { target, props: { bridge } })
  return {
    destroy: () => {
      void unmount(component)
    },
  }
}
