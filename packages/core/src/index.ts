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
} from './settings.ts'
export type {
  Format,
  PanelChanges,
  PanelCreateInput,
  PanelSettings,
  PresetName,
  Retention,
  UpdateMode,
  ViewType,
} from './settings.ts'
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
export { VIEW_RULES, followsNewest, isKeyed, validateCreate, validateUpdate } from './validate.ts'
export type { Issue, ValidationResult } from './validate.ts'
