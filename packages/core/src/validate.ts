import type { ZodError } from 'zod'
import { isPlainObject, withoutUndefined } from './object.ts'
import { resolvePanel, type ResolvedPanel } from './presets.ts'
import {
  FIXED_SETTINGS,
  FORMATS,
  UPDATE_MODES,
  panelChangesSchema,
  panelCreateSchema,
  type Format,
  type PanelSettings,
  type UpdateMode,
  type ViewType,
} from './settings.ts'

export interface Issue {
  path: string
  message: string
}

export interface ValidationResult {
  settings?: PanelSettings
  issues: Issue[]
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

  return checked({ ...current, ...withoutUndefined(parsed.data) })
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

  return issues
}

function hasNamedFields(format: Format, header: boolean | undefined): boolean {
  return format === 'ndjson' || (format === 'csv' && header !== false)
}

function toIssues(error: ZodError): Issue[] {
  return error.issues.flatMap((issue) => {
    if (issue.code === 'unrecognized_keys') {
      return issue.keys.map((name) => ({ path: name, message: `unknown setting "${name}"` }))
    }

    return [{ path: issue.path.map(String).join('.'), message: issue.message }]
  })
}
