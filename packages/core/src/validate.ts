import type { ZodError } from 'zod'
import { NETWORK_HOSTS, isAllowedUrl } from './network.ts'
import { isPlainObject, withoutUndefined } from './object.ts'
import { resolvePanel, type ResolvedPanel } from './presets.ts'
import {
  FIXED_SETTINGS,
  FORMATS,
  UPDATE_MODES,
  panelChangesSchema,
  panelCreateSchema,
  windowUpdateSchema,
  type Format,
  type PanelSettings,
  type UpdateMode,
  type ViewType,
  type WindowSettings,
} from './settings.ts'
import {
  MAX_SERIES,
  VIEW_SETTINGS_NAMES,
  type ChartSettings,
  type GaugeSettings,
} from './view-settings.ts'

export interface Issue {
  path: string
  message: string
}

export interface ValidationResult {
  settings?: PanelSettings
  issues: Issue[]
}

export interface WindowValidationResult {
  settings?: WindowSettings
  issues: Issue[]
}

// Validates window_update changes, which replace whole fields, against the current window settings.
export function validateWindowUpdate(
  current: WindowSettings,
  changes: unknown,
): WindowValidationResult {
  const parsed = windowUpdateSchema.safeParse(changes)
  if (!parsed.success) {
    return { issues: toIssues(parsed.error) }
  }

  const settings = { ...current, ...withoutUndefined(parsed.data) }
  if (!settings.name) {
    return {
      issues: [
        { path: 'name', message: 'name is required on the first window_update: the window title' },
      ],
    }
  }

  return { settings, issues: [] }
}

interface ViewRule {
  formats: readonly Format[]
  updates: readonly UpdateMode[]
  follow: boolean
}

// Which data each view can show, and whether it can keep the newest data in view.
export const VIEW_RULES: Record<ViewType, ViewRule> = {
  log: { formats: ['lines'], updates: ['append'], follow: true },
  table: { formats: ['ndjson', 'csv'], updates: ['append', 'upsert', 'patch'], follow: true },
  chart: { formats: ['ndjson', 'csv'], updates: ['append', 'upsert', 'patch'], follow: true },
  graph: { formats: ['ndjson', 'csv'], updates: ['append', 'upsert', 'patch'], follow: false },
  map: { formats: ['ndjson'], updates: ['append', 'upsert', 'patch'], follow: false },
  document: { formats: ['whole'], updates: ['replace', 'append'], follow: false },
  gauge: { formats: ['lines', 'ndjson'], updates: ['replace'], follow: false },
  custom: { formats: FORMATS, updates: UPDATE_MODES, follow: false },
}

export function isKeyed(update: UpdateMode): boolean {
  return update === 'upsert' || update === 'patch'
}

// Whether the panel keeps the newest data in view. Defaults to on for append panels whose view supports it.
export function followsNewest(settings: PanelSettings): boolean {
  if (!VIEW_RULES[settings.view].follow) {
    return false
  }

  return settings.follow ?? settings.update === 'append'
}

export function validateCreate(input: unknown): ValidationResult {
  const parsed = panelCreateSchema.safeParse(input)
  if (!parsed.success) {
    return { issues: toIssues(parsed.error) }
  }

  const completed = complete(resolvePanel(parsed.data))
  if (!completed.settings) {
    return completed
  }

  return checked(completed.settings)
}

// Validates panel_update changes, which replace whole settings, against the panel's current settings.
export function validateUpdate(current: PanelSettings, changes: unknown): ValidationResult {
  if (!isPlainObject(changes)) {
    return {
      issues: [{ path: '', message: 'changes must be an object of the settings to replace' }],
    }
  }

  const issues: Issue[] = []
  const replaceable: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(changes)) {
    if (name === 'id') {
      issues.push({ path: name, message: "id identifies the panel and can't change" })
      continue
    }

    if (name === 'preset') {
      issues.push({ path: name, message: 'presets only apply when a panel is created' })
      continue
    }

    if (FIXED_SETTINGS.has(name)) {
      issues.push({
        path: name,
        message: `${name} is fixed at creation; remove the panel and create a new one`,
      })
      continue
    }

    replaceable[name] = value
  }

  const parsed = panelChangesSchema.safeParse(replaceable)
  if (!parsed.success) {
    issues.push(...toIssues(parsed.error))
  }

  if (!parsed.success || issues.length > 0) {
    return { issues }
  }

  // A new view starts without the previous view's settings object.
  const { view } = parsed.data
  const kept: Record<string, unknown> = { ...current }
  if (view && view !== current.view) {
    delete kept[current.view]
  }

  const settings: Record<string, unknown> = { ...kept, ...withoutUndefined(parsed.data) }
  for (const [name, value] of Object.entries(parsed.data)) {
    if (value === null) {
      delete settings[name]
    }
  }

  return checked(settings as unknown as PanelSettings)
}

function complete(resolved: ResolvedPanel): ValidationResult {
  const { format, update, view } = resolved
  if (format && update && view) {
    return { settings: { ...resolved, format, update, view }, issues: [] }
  }

  const issues: Issue[] = []
  if (!format) {
    issues.push({
      path: 'format',
      message: `format is required (or pick a preset): one of ${FORMATS.join(', ')}`,
    })
  }

  if (!update) {
    issues.push({
      path: 'update',
      message: `update is required (or pick a preset): one of ${UPDATE_MODES.join(', ')}`,
    })
  }

  if (!view) {
    issues.push({ path: 'view', message: 'view is required (or pick a preset)' })
  }

  return { issues }
}

function checked(settings: PanelSettings): ValidationResult {
  const issues = checkRules(settings)
  if (issues.length > 0) {
    return { issues }
  }

  return { settings, issues }
}

function checkRules(settings: PanelSettings): Issue[] {
  const { view, format, update, key, header, retention, follow } = settings
  const rule = VIEW_RULES[view]
  const issues: Issue[] = []

  if (!rule.formats.includes(format)) {
    issues.push({
      path: 'view',
      message: `the ${view} view needs format ${rule.formats.join(' or ')}, but this panel's format is ${format}`,
    })
  }

  if (!rule.updates.includes(update)) {
    issues.push({
      path: 'view',
      message: `the ${view} view needs update ${rule.updates.join(' or ')}, but this panel's update is ${update}`,
    })
  }

  if (isKeyed(update) && !key) {
    issues.push({
      path: 'key',
      message: `${update} needs a key: the field that identifies each item, e.g. "id"`,
    })
  }

  if (!isKeyed(update) && key) {
    issues.push({ path: 'key', message: 'key only applies to upsert and patch' })
  }

  if (isKeyed(update) && !hasNamedFields(format, header)) {
    issues.push({
      path: 'format',
      message: `${update} matches items by a named field, which needs format ndjson, or csv with a header`,
    })
  }

  if (header !== undefined && format !== 'csv') {
    issues.push({ path: 'header', message: 'header only applies to csv' })
  }

  if (update === 'replace' && retention !== 'all') {
    issues.push({
      path: 'retention',
      message: "replace keeps only the latest item, so retention doesn't apply",
    })
  }

  if (follow && !rule.follow) {
    issues.push({ path: 'follow', message: `the ${view} view doesn't support follow` })
  }

  for (const name of VIEW_SETTINGS_NAMES) {
    if (settings[name] !== undefined && name !== view) {
      issues.push({ path: name, message: `${name} settings only apply to the ${name} view` })
    }
  }

  return [...issues, ...viewIssues(settings)]
}

// What a view needs from its settings object, and contradictions within it.
function viewIssues(settings: PanelSettings): Issue[] {
  if (settings.view === 'chart') {
    return chartIssues(settings.chart ?? {})
  }

  if (settings.view === 'gauge') {
    return gaugeIssues(settings.gauge ?? {}, settings.format)
  }

  // A named base map is OpenFreeMap's; any other style must be on an allowed host.
  const baseMap = settings.map?.base_map
  const named = baseMap === 'light' || baseMap === 'dark'
  if (settings.view === 'map' && typeof baseMap === 'string' && !named && !isAllowedUrl(baseMap)) {
    return [
      {
        path: 'map.base_map',
        message: `map.base_map must be "light", "dark", an https style URL on an allowed host (${NETWORK_HOSTS.join(', ')}), or false for no base map`,
      },
    ]
  }

  if (settings.view === 'custom' && !settings.custom) {
    return [
      {
        path: 'custom',
        message:
          'the custom view needs custom.code: JavaScript that renders the panel with the tapet object',
      },
    ]
  }

  return []
}

const UPLOT_SETTINGS = ['x', 'x_type', 'y', 'series', 'type'] as const

function chartIssues(chart: ChartSettings): Issue[] {
  const issues: Issue[] = []
  if (chart.engine === 'vega-lite') {
    if (!chart.spec) {
      issues.push({
        path: 'chart.spec',
        message:
          'the vega-lite engine needs chart.spec: a Vega-Lite spec whose data is { "name": "tapet" }',
      })
    }

    for (const name of UPLOT_SETTINGS) {
      if (chart[name] !== undefined) {
        issues.push({
          path: `chart.${name}`,
          message: `chart.${name} only applies to the uplot engine; with vega-lite, the spec says it`,
        })
      }
    }

    return issues
  }

  if (chart.spec) {
    issues.push({ path: 'chart.spec', message: 'chart.spec only applies to engine "vega-lite"' })
  }

  if (chart.y === undefined) {
    issues.push({
      path: 'chart.y',
      message:
        'the chart view needs chart.y: the field to plot, or a list of fields, e.g. "latency"',
    })
  }

  if (chart.series && Array.isArray(chart.y) && chart.y.length > 1) {
    issues.push({
      path: 'chart.series',
      message: 'chart.series splits one y field into a line per value, so y must be a single field',
    })
  }

  if (Array.isArray(chart.y) && chart.y.length > MAX_SERIES) {
    issues.push({
      path: 'chart.y',
      message: `chart.y can name at most ${MAX_SERIES} fields, one per series color`,
    })
  }

  const several = chart.series !== undefined || (Array.isArray(chart.y) && chart.y.length > 1)
  if (chart.type === 'bar' && several) {
    issues.push({
      path: 'chart.type',
      message:
        'the bar type draws a single series; for grouped or stacked bars, use engine "vega-lite"',
    })
  }

  if (chart.x_type && !chart.x) {
    issues.push({
      path: 'chart.x_type',
      message: 'chart.x_type describes chart.x; without x, the chart uses the arrival time',
    })
  }

  return issues
}

function gaugeIssues(gauge: GaugeSettings, format: Format): Issue[] {
  const issues: Issue[] = []
  const { style = 'number', min = 0, max } = gauge
  if (gauge.value && format === 'lines') {
    issues.push({
      path: 'gauge.value',
      message:
        'gauge.value names a field of ndjson items; with format lines, each line is the value',
    })
  }

  if (style !== 'number' && max === undefined) {
    issues.push({
      path: 'gauge.max',
      message: `the ${style} style needs gauge.max: the top of the scale, e.g. 100`,
    })
  }

  if (max !== undefined && max <= min) {
    issues.push({
      path: 'gauge.max',
      message: `gauge.max must be greater than gauge.min (${min})`,
    })
  }

  return issues
}

function hasNamedFields(format: Format, header: boolean | undefined): boolean {
  return format === 'ndjson' || (format === 'csv' && header !== false)
}

function toIssues(error: ZodError): Issue[] {
  return error.issues.flatMap((issue) => {
    if (issue.code === 'unrecognized_keys') {
      return issue.keys.map((name) => {
        const path = [...issue.path.map(String), name].join('.')
        return { path, message: `unknown setting "${path}"` }
      })
    }

    return [{ path: issue.path.map(String).join('.'), message: issue.message }]
  })
}
