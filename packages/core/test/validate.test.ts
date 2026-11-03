import { describe, expect, it } from 'vitest'
import {
  PRESETS,
  PRESET_NAMES,
  followsNewest,
  validateCreate,
  validateUpdate,
  validateWindowUpdate,
  type PanelSettings,
} from '../src/index.ts'

const base = { id: 'p', title: 'Panel' }

function paths(input: unknown) {
  return validateCreate(input).issues.map((issue) => issue.path)
}

function messageAt(input: unknown, path: string) {
  return validateCreate(input).issues.find((issue) => issue.path === path)?.message
}

describe('presets', () => {
  // Presets hold no field names, so some views need them from the agent.
  const needs: Record<string, object> = { timeseries: { chart: { y: 'latency' } } }

  it.each(PRESET_NAMES)('%s produces valid settings', (preset) => {
    const { settings, issues } = validateCreate({ ...base, preset, ...needs[preset] })
    expect(issues).toEqual([])
    expect(settings).toMatchObject(PRESETS[preset])
  })

  it('fills in defaults, with follow on for logs', () => {
    const { settings } = validateCreate({ ...base, preset: 'log' })
    expect(settings).toEqual({
      ...base,
      format: 'lines',
      update: 'append',
      view: 'log',
      retention: 'all',
    })
    expect(followsNewest(settings as PanelSettings)).toBe(true)
  })

  it('lets explicit settings win over the preset', () => {
    const { settings } = validateCreate({
      ...base,
      preset: 'log',
      retention: { last: 100 },
      css: 'x',
    })
    expect(settings).toMatchObject({ retention: { last: 100 }, css: 'x' })
  })

  it("drops the preset's key when the update mode is overridden to one without keys", () => {
    const { settings, issues } = validateCreate({ ...base, preset: 'graph', update: 'append' })
    expect(issues).toEqual([])
    expect(settings?.key).toBeUndefined()
  })
})

describe('validateCreate', () => {
  it('defaults csv to having a header', () => {
    const { settings } = validateCreate({ ...base, format: 'csv', update: 'append', view: 'table' })
    expect(settings?.header).toBe(true)
  })

  it('requires format, update and view without a preset', () => {
    expect(paths(base)).toEqual(['format', 'update', 'view'])
  })

  it('accepts only simple panel ids', () => {
    expect(paths({ ...base, id: 'api-log_2', preset: 'log' })).toEqual([])
    expect(paths({ ...base, id: 'api log', preset: 'log' })).toEqual(['id'])
    expect(paths({ ...base, id: '9lives', preset: 'log' })).toEqual(['id'])
  })

  it('requires a title', () => {
    expect(messageAt({ ...base, title: '  ', preset: 'log' }, 'title')).toContain(
      'title is required',
    )
  })

  it('names unknown settings, which catches typos', () => {
    expect(validateCreate({ ...base, preset: 'log', retension: 'all' }).issues).toEqual([
      { path: 'retension', message: 'unknown setting "retension"' },
    ])
  })

  it('explains which formats and update modes a view accepts', () => {
    expect(messageAt({ ...base, preset: 'log', format: 'ndjson' }, 'view')).toBe(
      "the log view needs format lines, but this panel's format is ndjson",
    )
    expect(messageAt({ ...base, format: 'lines', update: 'replace', view: 'log' }, 'view')).toBe(
      "the log view needs update append, but this panel's update is replace",
    )
  })

  it('requires a key for upsert and patch, and only for them', () => {
    expect(
      messageAt({ ...base, format: 'ndjson', update: 'upsert', view: 'table' }, 'key'),
    ).toContain('upsert needs a key')
    expect(messageAt({ ...base, preset: 'log', key: 'id' }, 'key')).toBe(
      'key only applies to upsert and patch',
    )
  })

  it('requires named fields for keyed updates', () => {
    const input = {
      ...base,
      format: 'csv',
      header: false,
      update: 'upsert',
      key: 'id',
      view: 'table',
    }
    expect(messageAt(input, 'format')).toContain('needs format ndjson, or csv with a header')
  })

  it('allows header only with csv', () => {
    expect(messageAt({ ...base, preset: 'table', header: true }, 'header')).toBe(
      'header only applies to csv',
    )
  })

  it('rejects retention on replace panels, and malformed retention', () => {
    expect(messageAt({ ...base, preset: 'gauge', retention: { last: 5 } }, 'retention')).toContain(
      "retention doesn't apply",
    )
    expect(messageAt({ ...base, preset: 'log', retention: { last: 0 } }, 'retention.last')).toBe(
      'last must be a whole number of items, at least 1',
    )
    expect(messageAt({ ...base, preset: 'log', retention: 'forever' }, 'retention')).toContain(
      'retention must be "all"',
    )
  })

  it('rejects follow on views that cannot follow', () => {
    expect(messageAt({ ...base, preset: 'graph', follow: true }, 'follow')).toBe(
      "the graph view doesn't support follow",
    )
  })

  it('reports several issues together', () => {
    expect(paths({ ...base, format: 'ndjson', update: 'upsert', view: 'log' })).toEqual([
      'view',
      'view',
      'key',
    ])
  })
})

describe('validateUpdate', () => {
  const current = validateCreate({ id: 'api-log', title: 'API log', preset: 'log' })
    .settings as PanelSettings

  it('replaces the settings it is given and keeps the rest', () => {
    const { settings, issues } = validateUpdate(current, { title: 'New', retention: { last: 10 } })
    expect(issues).toEqual([])
    expect(settings).toEqual({ ...current, title: 'New', retention: { last: 10 } })
  })

  it('rejects settings fixed at creation', () => {
    const { issues } = validateUpdate(current, { format: 'ndjson', key: 'id' })
    expect(issues.map((issue) => issue.path)).toEqual(['format', 'key'])
    expect(issues[0]?.message).toBe(
      'format is fixed at creation; remove the panel and create a new one',
    )
  })

  it('rejects id, presets and unknown settings', () => {
    const { issues } = validateUpdate(current, { id: 'x', preset: 'table', colour: 'red' })
    expect(issues.map((issue) => issue.path)).toEqual(['id', 'preset', 'colour'])
  })

  it("checks a new view against the panel's fixed settings", () => {
    const { issues } = validateUpdate(current, { view: 'table' })
    expect(issues).toEqual([
      {
        path: 'view',
        message: "the table view needs format ndjson or csv, but this panel's format is lines",
      },
    ])
  })

  it('derives follow again for the new view when the agent never set it', () => {
    const { settings, issues } = validateUpdate(current, {
      view: 'custom',
      custom: { code: 'tapet.root.textContent = "hi"' },
    })
    expect(issues).toEqual([])
    expect(followsNewest(settings as PanelSettings)).toBe(false)
  })
})

describe('view settings', () => {
  it("keeps the view's own settings object", () => {
    const gauge = { value: 'cpu', style: 'dial', max: 100, unit: '%' } as const
    const { settings, issues } = validateCreate({
      ...base,
      preset: 'gauge',
      format: 'ndjson',
      gauge,
    })
    expect(issues).toEqual([])
    expect(settings?.gauge).toEqual(gauge)
  })

  it("rejects another view's settings object", () => {
    expect(messageAt({ ...base, preset: 'log', table: { columns: ['a'] } }, 'table')).toBe(
      'table settings only apply to the table view',
    )
  })

  it('names unknown and malformed settings inside the object', () => {
    expect(paths({ ...base, preset: 'table', table: { colums: ['a'] } })).toEqual(['table.colums'])
    expect(
      messageAt({ ...base, preset: 'document', document: { content: 'pdf' } }, 'document.content'),
    ).toBe('document.content must be one of: markdown, html, text, image')
  })

  it('requires what a view cannot do without', () => {
    expect(messageAt({ ...base, preset: 'timeseries' }, 'chart.y')).toContain(
      'the chart view needs chart.y',
    )
    expect(
      messageAt({ ...base, preset: 'timeseries', chart: { engine: 'vega-lite' } }, 'chart.spec'),
    ).toContain('needs chart.spec')
    expect(
      messageAt({ ...base, format: 'lines', update: 'append', view: 'custom' }, 'custom'),
    ).toContain('the custom view needs custom.code')
    expect(
      messageAt({ ...base, preset: 'gauge', gauge: { style: 'dial' } }, 'gauge.max'),
    ).toContain('the dial style needs gauge.max')
  })

  it('rejects contradictions within the object', () => {
    const vegaLite = { engine: 'vega-lite', spec: { mark: 'bar' }, y: 'count' }
    expect(messageAt({ ...base, preset: 'timeseries', chart: vegaLite }, 'chart.y')).toContain(
      'only applies to the uplot engine',
    )
    expect(
      messageAt(
        { ...base, preset: 'timeseries', chart: { y: ['p50', 'p99'], series: 'host' } },
        'chart.series',
      ),
    ).toContain('y must be a single field')
    expect(
      messageAt(
        { ...base, preset: 'timeseries', chart: { y: ['a', 'b'], type: 'bar' } },
        'chart.type',
      ),
    ).toContain('use engine "vega-lite"')
    const nine = Array.from({ length: 9 }, (_, index) => `f${index}`)
    expect(messageAt({ ...base, preset: 'timeseries', chart: { y: nine } }, 'chart.y')).toContain(
      'at most 8 fields',
    )
    expect(
      messageAt({ ...base, preset: 'gauge', gauge: { value: 'cpu' } }, 'gauge.value'),
    ).toContain('with format lines, each line is the value')
  })

  it('takes base maps by name, or only from allowed hosts', () => {
    const map = (base_map: unknown) => ({ ...base, preset: 'map', map: { base_map } })
    expect(paths(map('light'))).toEqual([])
    expect(paths(map('dark'))).toEqual([])
    expect(paths(map('https://tiles.openfreemap.org/styles/positron'))).toEqual([])
    expect(paths(map(false))).toEqual([])
    expect(messageAt(map('satellite'), 'map.base_map')).toContain('"light", "dark"')
    expect(messageAt(map('https://tiles.example.com/style.json'), 'map.base_map')).toContain(
      'allowed host (tiles.openfreemap.org',
    )
  })

  it('checks map.layers with MapLibre, at the path of each problem', () => {
    const map = (settings: object) => ({ ...base, preset: 'map', map: settings })
    const circles = {
      type: 'circle',
      paint: { 'circle-color': ['match', ['get', 'party'], 'A', 'red', 'gray'] },
    }
    expect(
      validateCreate(map({ layers: [circles], legend: [{ label: 'A', color: 'red' }] })).issues,
    ).toEqual([])
    expect(
      validateCreate(map({ layers: [{ type: 'circle', paint: { 'circle-color': 5 } }] })).issues,
    ).toEqual([
      { path: 'map.layers.0.paint.circle-color', message: 'color expected, number found' },
    ])
    expect(paths(map({ layers: [circles, { type: 'line', pain: {} }] }))).toEqual([
      'map.layers.1.pain',
    ])
    expect(paths(map({ layers: [{ type: 'raster' }] }))).toEqual(['map.layers.0.type'])
    expect(
      messageAt(map({ layers: [{ ...circles, source: 'x' }] }), 'map.layers.0.source'),
    ).toContain("each layer draws the panel's features")
    expect(messageAt(map({ layers: [] }), 'map.layers')).toContain('list of MapLibre layers')
  })

  it("leaves color to map.layers when it's set", () => {
    const layers = [{ type: 'circle' }]
    expect(
      messageAt({ ...base, preset: 'map', map: { layers, color_by: 'votes' } }, 'map.color_by'),
    ).toContain('color in the layer')
  })

  it("drops the previous view's object when the view changes", () => {
    const table = validateCreate({ ...base, preset: 'table', table: { columns: ['a'] } })
      .settings as PanelSettings
    const { settings, issues } = validateUpdate(table, { view: 'chart', chart: { y: 'a' } })
    expect(issues).toEqual([])
    expect(settings?.table).toBeUndefined()
    expect(settings?.chart).toEqual({ y: 'a' })
  })
})

describe('validateWindowUpdate', () => {
  it('requires a name on the first update', () => {
    const { issues } = validateWindowUpdate({}, { width: 800 })
    expect(issues.map((issue) => issue.path)).toEqual(['name'])
  })

  it('replaces the fields it is given and keeps the rest', () => {
    const { settings } = validateWindowUpdate(
      { name: 'logs', width: 800 },
      { height: 600, css: 'x' },
    )
    expect(settings).toEqual({ name: 'logs', width: 800, height: 600, css: 'x' })
  })

  it('rejects unknown fields and windows smaller than 200 pixels', () => {
    const { issues } = validateWindowUpdate({ name: 'logs' }, { width: 100, colour: 'red' })
    expect(issues.map((issue) => issue.path).sort()).toEqual(['colour', 'width'])
  })
})

describe('smart', () => {
  it('accepts a smart trait on any panel', () => {
    const smart = {
      prompt: 'Summarize errors',
      every: { items: 10 },
      history: 3,
      model: 'anthropic/claude-haiku-4-5',
    }
    expect(validateCreate({ ...base, preset: 'log', smart }).settings?.smart).toEqual(smart)
  })

  it('explains a missing prompt and a malformed trigger', () => {
    expect(
      messageAt({ ...base, preset: 'log', smart: { every: { items: 10 } } }, 'smart.prompt'),
    ).toContain('smart.prompt is required')
    expect(
      messageAt(
        { ...base, preset: 'log', smart: { prompt: 'x', every: { lines: 10 } } },
        'smart.every',
      ),
    ).toContain('smart.every must be')
  })

  it('removes the smart trait, or any optional setting, when panel_update sends null', () => {
    const current = validateCreate({
      ...base,
      preset: 'log',
      css: 'x',
      smart: { prompt: 'Summarize' },
    }).settings as PanelSettings
    const { settings } = validateUpdate(current, { smart: null, css: null })
    expect(settings?.smart).toBeUndefined()
    expect(settings?.css).toBeUndefined()
  })
})
