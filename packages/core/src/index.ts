// Trait system core: formats, update modes, retention, presets and validation.
export { createDecoder } from './formats/index.ts'
export type { DecodeResult, Decoder, DecoderOptions, MalformedError } from './formats/index.ts'
export { mergePatch } from './merge-patch.ts'
export { PRESETS, resolvePanel } from './presets.ts'
export type { Preset, ResolvedPanel } from './presets.ts'
export {
  FIXED_SETTINGS,
  FORMATS,
  PANEL_ID_PATTERN,
  PRESET_NAMES,
  UPDATE_MODES,
  VIEW_TYPES,
  panelChangesSchema,
  panelCreateSchema,
  windowUpdateSchema,
} from './settings.ts'
export type {
  Format,
  PanelChanges,
  PanelCreateInput,
  PanelSettings,
  PresetName,
  Retention,
  SmartSettings,
  UpdateMode,
  ViewType,
  WindowSettings,
} from './settings.ts'
export {
  CHART_ENGINES,
  CHART_TYPES,
  CUSTOM_SURFACES,
  DOCUMENT_CONTENTS,
  GAUGE_STYLES,
  GRAPH_LAYOUTS,
  MAX_SERIES,
  VIEW_SETTINGS_NAMES,
  X_TYPES,
} from './view-settings.ts'
export type {
  ChartSettings,
  CustomSettings,
  DocumentSettings,
  GaugeSettings,
  GraphSettings,
  MapSettings,
  TableSettings,
  ViewSettingsName,
} from './view-settings.ts'
export { createStore } from './store.ts'
export type {
  ApplyResult,
  Change,
  Entry,
  EntryKey,
  InvalidItem,
  Store,
  StoreOptions,
} from './store.ts'
export {
  VIEW_RULES,
  followsNewest,
  isKeyed,
  validateCreate,
  validateUpdate,
  validateWindowUpdate,
} from './validate.ts'
export type { Issue, ValidationResult, WindowValidationResult } from './validate.ts'
