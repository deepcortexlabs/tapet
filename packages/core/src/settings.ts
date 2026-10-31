import { z } from 'zod'

export const FORMATS = ['lines', 'ndjson', 'csv', 'whole'] as const
export const UPDATE_MODES = ['append', 'replace', 'upsert', 'patch'] as const
export const VIEW_TYPES = [
  'log',
  'table',
  'chart',
  'graph',
  'map',
  'document',
  'gauge',
  'custom',
] as const
export const PRESET_NAMES = [
  'log',
  'timeseries',
  'table',
  'graph',
  'document',
  'gauge',
  'map',
] as const

export type Format = (typeof FORMATS)[number]
export type UpdateMode = (typeof UPDATE_MODES)[number]
export type ViewType = (typeof VIEW_TYPES)[number]
export type PresetName = (typeof PRESET_NAMES)[number]
export type Retention = 'all' | { last: number } | { seconds: number }

// Simple names keep agent CSS like `[data-panel=api-log]` free of quoting and escaping.
export const PANEL_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/

// Settings that decide how incoming data is interpreted. They can't change after creation.
export const FIXED_SETTINGS: ReadonlySet<string> = new Set(['format', 'header', 'update', 'key'])

export interface PanelSettings {
  id: string
  title: string
  format: Format
  header?: boolean
  update: UpdateMode
  key?: string
  retention: Retention
  view: ViewType
  // Only set when the agent chose it; see followsNewest() for the effective value.
  follow?: boolean
  mapping?: Record<string, unknown>
  css?: string
  smart?: SmartSettings
}

// The smart trait: an LLM that reads the panel's new data and keeps a rolling output.
export interface SmartSettings {
  prompt: string
  // When to run on its own: after N new items, or every T seconds. Omit to run only via smart_run.
  every?: { items: number } | { seconds: number }
  // How many past outputs each run sees. Defaults to 1.
  history?: number
  // "provider/model"; defaults to the config's default_model.
  model?: string
}

const ID_MESSAGE =
  'id must start with a letter and use only letters, digits, "-" and "_" (at most 64 characters), e.g. "api-log"'
const TITLE_MESSAGE = 'title is required: a short, human-readable name for the panel'
const KEY_MESSAGE = 'key must be the name of the field that identifies each item, e.g. "id"'

const title = z.string({ error: TITLE_MESSAGE }).trim().min(1, { error: TITLE_MESSAGE })
const format = z.enum(FORMATS, { error: `format must be one of: ${FORMATS.join(', ')}` })
const header = z.boolean({ error: 'header must be true or false' })
const update = z.enum(UPDATE_MODES, { error: `update must be one of: ${UPDATE_MODES.join(', ')}` })
const key = z.string({ error: KEY_MESSAGE }).min(1, { error: KEY_MESSAGE })
const LAST_MESSAGE = 'last must be a whole number of items, at least 1'
const SECONDS_MESSAGE = 'seconds must be a number greater than 0'
const retention = z.union(
  [
    z.literal('all'),
    z.strictObject({ last: z.int({ error: LAST_MESSAGE }).positive({ error: LAST_MESSAGE }) }),
    z.strictObject({
      seconds: z.number({ error: SECONDS_MESSAGE }).positive({ error: SECONDS_MESSAGE }),
    }),
  ],
  {
    error:
      'retention must be "all", { last: <number of items> } or { seconds: <number of seconds> }',
  },
)
const view = z.enum(VIEW_TYPES, { error: `view must be one of: ${VIEW_TYPES.join(', ')}` })
const follow = z.boolean({ error: 'follow must be true or false' })
const mapping = z.record(z.string(), z.unknown(), { error: 'mapping must be an object' })
const css = z.string({ error: 'css must be a string' })
const PROMPT_MESSAGE = "smart.prompt is required: what the LLM should do with the panel's new data"
const smart = z.strictObject(
  {
    prompt: z.string({ error: PROMPT_MESSAGE }).trim().min(1, { error: PROMPT_MESSAGE }),
    every: z
      .union(
        [
          z.strictObject({ items: z.int().positive() }),
          z.strictObject({ seconds: z.number().positive() }),
        ],
        { error: 'smart.every must be { items: <number of new items> } or { seconds: <seconds> }' },
      )
      .optional(),
    history: z
      .int({ error: 'smart.history must be a whole number, at least 1' })
      .positive({ error: 'smart.history must be a whole number, at least 1' })
      .optional(),
    model: z
      .string()
      .regex(/^[a-z][a-z0-9-]*\/\S+$/, {
        error: 'smart.model must look like "provider/model", e.g. "anthropic/claude-haiku-4-5"',
      })
      .optional(),
  },
  { error: 'smart must be an object with at least a prompt' },
)

// Input of panel_create. A preset fills in whatever the agent leaves out.
export const panelCreateSchema = z.strictObject({
  id: z.string({ error: ID_MESSAGE }).regex(PANEL_ID_PATTERN, { error: ID_MESSAGE }),
  title,
  preset: z
    .enum(PRESET_NAMES, { error: `preset must be one of: ${PRESET_NAMES.join(', ')}` })
    .optional(),
  format: format.optional(),
  header: header.optional(),
  update: update.optional(),
  key: key.optional(),
  retention: retention.optional(),
  view: view.optional(),
  follow: follow.optional(),
  mapping: mapping.optional(),
  css: css.optional(),
  smart: smart.optional(),
})

// Settings panel_update may replace; null clears an optional one. Fixed settings, id and preset
// are rejected before parsing.
export const panelChangesSchema = z.strictObject({
  title: title.optional(),
  retention: retention.optional(),
  view: view.optional(),
  follow: follow.nullable().optional(),
  mapping: mapping.nullable().optional(),
  css: css.nullable().optional(),
  smart: smart.nullable().optional(),
})

export type PanelCreateInput = z.output<typeof panelCreateSchema>
export type PanelChanges = z.output<typeof panelChangesSchema>

const NAME_MESSAGE = 'name must be the window title, e.g. "api logs"'
const SIZE_MESSAGE = 'width and height must be whole numbers of pixels, at least 200'
const POSITION_MESSAGE = 'x and y must be whole numbers of pixels'

// Input of window_update: fields sent replace those fields. The first call must include a name.
export const windowUpdateSchema = z.strictObject({
  name: z.string({ error: NAME_MESSAGE }).trim().min(1, { error: NAME_MESSAGE }).optional(),
  width: z.int({ error: SIZE_MESSAGE }).min(200, { error: SIZE_MESSAGE }).optional(),
  height: z.int({ error: SIZE_MESSAGE }).min(200, { error: SIZE_MESSAGE }).optional(),
  x: z.int({ error: POSITION_MESSAGE }).optional(),
  y: z.int({ error: POSITION_MESSAGE }).optional(),
  always_on_top: z.boolean({ error: 'always_on_top must be true or false' }).optional(),
  css: css.optional(),
})

export type WindowSettings = z.output<typeof windowUpdateSchema>
