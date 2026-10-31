import { z } from 'zod'

// Each view's own settings live in an object named after the view: which data fields it shows,
// and how, e.g. { view: "gauge", gauge: { value: "cpu", style: "dial", max: 100 } }.

export const DOCUMENT_CONTENTS = ['markdown', 'html', 'text', 'image'] as const
export const GAUGE_STYLES = ['number', 'dial', 'bar'] as const
export const CHART_ENGINES = ['uplot', 'vega-lite'] as const
export const CHART_TYPES = ['line', 'area', 'bar', 'points'] as const
export const X_TYPES = ['time', 'number'] as const
export const GRAPH_LAYOUTS = ['force', 'hierarchical'] as const
export const CUSTOM_SURFACES = ['dom', 'canvas2d', 'webgl'] as const
// A chart draws at most this many series, one per color of the theme's series palette.
export const MAX_SERIES = 8

function field(path: string, example: string) {
  const message = `${path} must be the name of a field, e.g. "${example}"`
  return z.string({ error: message }).min(1, { error: message })
}

function fieldList(path: string, example: string) {
  const message = `${path} must be a list of field names, e.g. ${example}`
  return z.array(z.string({ error: message }).min(1, { error: message }), { error: message })
}

function oneOf<const T extends readonly [string, ...string[]]>(path: string, values: T) {
  return z.enum(values, { error: `${path} must be one of: ${values.join(', ')}` })
}

export const tableSettings = z.strictObject(
  { columns: fieldList('table.columns', '["time", "level", "message"]').optional() },
  { error: 'table must be an object, e.g. { columns: ["time", "message"] }' },
)

export const documentSettings = z.strictObject(
  { content: oneOf('document.content', DOCUMENT_CONTENTS).optional() },
  { error: 'document must be an object, e.g. { content: "html" }' },
)

const THRESHOLDS_MESSAGE =
  'gauge.thresholds must be a list like [{ at: 70, color: "orange" }, { at: 90, color: "red" }]'

export const gaugeSettings = z.strictObject(
  {
    value: field('gauge.value', 'cpu').optional(),
    style: oneOf('gauge.style', GAUGE_STYLES).optional(),
    min: z.number({ error: 'gauge.min must be a number' }).optional(),
    max: z.number({ error: 'gauge.max must be a number' }).optional(),
    unit: z.string({ error: 'gauge.unit must be a string, e.g. "%"' }).optional(),
    thresholds: z
      .array(
        z.strictObject(
          {
            at: z.number({ error: THRESHOLDS_MESSAGE }),
            color: z.string({ error: THRESHOLDS_MESSAGE }).min(1, { error: THRESHOLDS_MESSAGE }),
          },
          { error: THRESHOLDS_MESSAGE },
        ),
        { error: THRESHOLDS_MESSAGE },
      )
      .optional(),
  },
  { error: 'gauge must be an object, e.g. { value: "cpu", style: "dial", max: 100 }' },
)

export const chartSettings = z.strictObject(
  {
    engine: oneOf('chart.engine', CHART_ENGINES).optional(),
    x: field('chart.x', 'time').optional(),
    x_type: oneOf('chart.x_type', X_TYPES).optional(),
    y: z
      .union([field('chart.y', 'latency'), fieldList('chart.y', '["p50", "p99"]').min(1)], {
        error: 'chart.y must be a field name or a list of field names, e.g. "latency"',
      })
      .optional(),
    series: field('chart.series', 'host').optional(),
    type: oneOf('chart.type', CHART_TYPES).optional(),
    spec: z
      .record(z.string(), z.unknown(), { error: 'chart.spec must be a Vega-Lite spec object' })
      .optional(),
  },
  { error: 'chart must be an object, e.g. { x: "time", y: "latency" }' },
)

export const graphSettings = z.strictObject(
  {
    id: field('graph.id', 'id').optional(),
    source: field('graph.source', 'from').optional(),
    target: field('graph.target', 'to').optional(),
    label: field('graph.label', 'name').optional(),
    color: field('graph.color', 'group').optional(),
    size: field('graph.size', 'weight').optional(),
    layout: oneOf('graph.layout', GRAPH_LAYOUTS).optional(),
  },
  { error: 'graph must be an object, e.g. { source: "from", target: "to" }' },
)

export const mapSettings = z.strictObject(
  {
    base_map: z
      .union([z.url({ protocol: /^https?$/ }), z.literal(false)], {
        error: 'map.base_map must be the URL of a MapLibre style, or false for no base map',
      })
      .optional(),
    label_language: z
      .string()
      .regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, {
        error: 'map.label_language must be a language code, e.g. "en" or "he"',
      })
      .optional(),
    color_by: field('map.color_by', 'votes').optional(),
    colors: z
      .array(z.string().min(1), { error: 'map.colors must be a list of CSS colors' })
      .min(2, { error: 'map.colors needs at least two colors: the low and high ends of the scale' })
      .optional(),
    tooltip: fieldList('map.tooltip', '["name", "votes"]').optional(),
    borders: z.boolean({ error: 'map.borders must be true or false' }).optional(),
  },
  { error: 'map must be an object, e.g. { color_by: "votes" }' },
)

const CODE_MESSAGE =
  'custom.code is required: JavaScript that renders the panel with the tapet object'

export const customSettings = z.strictObject(
  {
    code: z.string({ error: CODE_MESSAGE }).regex(/\S/, { error: CODE_MESSAGE }),
    surface: oneOf('custom.surface', CUSTOM_SURFACES).optional(),
  },
  { error: 'custom must be an object with at least code' },
)

export type TableSettings = z.output<typeof tableSettings>
export type DocumentSettings = z.output<typeof documentSettings>
export type GaugeSettings = z.output<typeof gaugeSettings>
export type ChartSettings = z.output<typeof chartSettings>
export type GraphSettings = z.output<typeof graphSettings>
export type MapSettings = z.output<typeof mapSettings>
export type CustomSettings = z.output<typeof customSettings>

// The views that have a settings object. log has none.
export const VIEW_SETTINGS_NAMES = [
  'table',
  'document',
  'gauge',
  'chart',
  'graph',
  'map',
  'custom',
] as const

export type ViewSettingsName = (typeof VIEW_SETTINGS_NAMES)[number]
