import { withoutUndefined } from './object.ts'
import type {
  Format,
  PanelCreateInput,
  PanelSettings,
  PresetName,
  UpdateMode,
  ViewType,
} from './settings.ts'

export interface Preset {
  format: Format
  update: UpdateMode
  key?: string
  view: ViewType
}

export const PRESETS: Record<PresetName, Preset> = {
  log: { format: 'lines', update: 'append', view: 'log' },
  timeseries: { format: 'ndjson', update: 'append', view: 'chart' },
  table: { format: 'ndjson', update: 'append', view: 'table' },
  graph: { format: 'ndjson', update: 'upsert', key: 'id', view: 'graph' },
  document: { format: 'whole', update: 'replace', view: 'document' },
  gauge: { format: 'lines', update: 'replace', view: 'gauge' },
  map: { format: 'ndjson', update: 'upsert', key: 'id', view: 'map' },
}

// A panel_create input with its preset and defaults applied. Required settings may still be missing.
export type ResolvedPanel = Omit<PanelSettings, 'format' | 'update' | 'view'> &
  Partial<Pick<PanelSettings, 'format' | 'update' | 'view'>>

// Applies the preset, then the agent's explicit settings, which always win, then the remaining
// defaults. A preset's key only applies when the resolved update mode matches items by key, so
// overriding e.g. the graph preset's update to append doesn't leave a stray key behind.
export function resolvePanel(input: PanelCreateInput): ResolvedPanel {
  const { preset: presetName, ...explicit } = input
  const preset = presetName ? PRESETS[presetName] : undefined
  const format = explicit.format ?? preset?.format
  const update = explicit.update ?? preset?.update
  const keyed = update === 'upsert' || update === 'patch'

  return withoutUndefined({
    ...explicit,
    format,
    header: explicit.header ?? (format === 'csv' ? true : undefined),
    update,
    key: explicit.key ?? (keyed ? preset?.key : undefined),
    retention: explicit.retention ?? 'all',
    view: explicit.view ?? preset?.view,
  })
}
