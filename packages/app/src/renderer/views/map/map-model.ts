// The map view's features, without any DOM, so it's tested on its own: GeoJSON features, where each
// falls on the color_by scale, the bounds the view first zooms to, and the layers that draw them.
import type { Entry, MapSettings } from '@tapet/core'
import type { ExpressionSpecification, LayerSpecification } from 'maplibre-gl'

export interface Geometry {
  type: string
  coordinates?: unknown
  geometries?: Geometry[]
}

export interface Feature {
  type: 'Feature'
  id?: string | number
  geometry: Geometry | null
  properties: Record<string, unknown>
}

// Where a feature's color_by value falls between the smallest and largest, from 0 to 1. Features
// without a number have none and are drawn gray.
export const SCALE = 'tapet:scale'

// The panel's features on the map, as one GeoJSON source.
export const SOURCE = 'tapet'

export interface MapData {
  features: Feature[]
  // The smallest and largest color_by values.
  range?: [number, number]
  // [[west, south], [east, north]] around every coordinate.
  bounds?: [[number, number], [number, number]]
  warning?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toNumber(value: unknown): number | undefined {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return typeof number === 'number' && Number.isFinite(number) ? number : undefined
}

function isFeature(value: unknown): value is Feature & { properties?: unknown } {
  return isRecord(value) && value.type === 'Feature' && 'geometry' in value
}

// Every [longitude, latitude] pair in a geometry, however deeply nested.
function eachPosition(coordinates: unknown, visit: (lon: number, lat: number) => void) {
  if (!Array.isArray(coordinates)) {
    return
  }

  const [lon, lat] = coordinates
  if (typeof lon === 'number' && typeof lat === 'number') {
    visit(lon, lat)
    return
  }

  for (const child of coordinates) {
    eachPosition(child, visit)
  }
}

function eachGeometryPosition(
  geometry: Geometry | null,
  visit: (lon: number, lat: number) => void,
) {
  if (!geometry) {
    return
  }

  eachPosition(geometry.coordinates, visit)
  for (const child of geometry.geometries ?? []) {
    eachGeometryPosition(child, visit)
  }
}

export function buildMap(entries: Entry[], settings: MapSettings): MapData {
  const features: Feature[] = []
  let warning: string | undefined
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity
  const { color_by: colorBy } = settings
  const values: Array<number | undefined> = []

  for (const { value } of entries) {
    if (!isFeature(value)) {
      warning ??=
        'items must be GeoJSON features: { "type": "Feature", "geometry": …, "properties": … }'
      continue
    }

    const properties = isRecord(value.properties) ? value.properties : {}
    eachGeometryPosition(value.geometry, (lon, lat) => {
      west = Math.min(west, lon)
      south = Math.min(south, lat)
      east = Math.max(east, lon)
      north = Math.max(north, lat)
    })
    values.push(colorBy === undefined ? undefined : toNumber(properties[colorBy]))
    // A copy, so the panel's own data keeps no tapet additions.
    features.push({ ...value, properties: { ...properties } })
  }

  const numbers = values.filter((number): number is number => number !== undefined)
  let range: [number, number] | undefined
  if (numbers.length > 0) {
    let low = Infinity
    let high = -Infinity
    for (const number of numbers) {
      low = Math.min(low, number)
      high = Math.max(high, number)
    }

    range = [low, high]
    features.forEach((feature, index) => {
      const number = values[index]
      if (number !== undefined) {
        feature.properties[SCALE] = high === low ? 0.5 : (number - low) / (high - low)
      }
    })
  }

  const data: MapData = { features }
  if (range) {
    data.range = range
  }

  if (Number.isFinite(west)) {
    data.bounds = [
      [west, south],
      [east, north],
    ]
  }

  if (warning) {
    data.warning = warning
  }

  return data
}

// The base map's labels in the chosen language, falling back to the local name.
export function labelField(language: string): unknown[] {
  return ['coalesce', ['get', `name:${language}`], ['get', `name_${language}`], ['get', 'name']]
}

// The base map without country and region borders or names, so it takes no side where borders
// are disputed: boundary lines are hidden, and place labels leave out countries, states and
// continents. Cities, towns, roads and water keep their labels. Works on OpenMapTiles styles.
export interface LayerChange {
  id: string
  hide?: true
  filter?: unknown
}

const POLITICAL_PLACES = ['country', 'state', 'province', 'continent']

export function neutralize(
  layers: ReadonlyArray<{ id: string; 'source-layer'?: string; filter?: unknown }>,
): LayerChange[] {
  return layers.flatMap((layer): LayerChange[] => {
    if (layer['source-layer'] === 'boundary') {
      return [{ id: layer.id, hide: true }]
    }

    if (layer['source-layer'] !== 'place') {
      return []
    }

    const notPolitical = ['match', ['get', 'class'], POLITICAL_PLACES, false, true]
    return [
      { id: layer.id, filter: layer.filter ? ['all', layer.filter, notPolitical] : notPolitical },
    ]
  })
}

// The colors the panel draws with: the theme's, and the color_by ramp from low to high.
export interface MapColors {
  // For features without a color of their own, when there's no color_by.
  color: string
  fg: string
  muted: string
  surface: string
  ramp: string[]
}

// simplestyle-spec's marker sizes, as circle radii in pixels.
const MARKER_SIZES = { small: 3.5, medium: 5, large: 8 }
const LABEL_SIZE = 12

function expression(value: unknown[]): ExpressionSpecification {
  return value as ExpressionSpecification
}

function geometry(...types: string[]): ExpressionSpecification {
  return expression(['match', ['geometry-type'], types, true, false])
}

// A feature's number property, or the fallback when it has none.
function numberOr(property: string, fallback: number | ExpressionSpecification) {
  return expression([
    'case',
    ['==', ['typeof', ['get', property]], 'number'],
    ['get', property],
    fallback,
  ])
}

// A feature's color property, or the fallback when it has none or it isn't a color.
function colorOr(property: string, fallback: string | ExpressionSpecification) {
  return expression(['to-color', ['get', property], fallback])
}

// With color_by, a feature's place on the ramp, and gray without a number. Each stop is a color
// explicitly, because inside to-color nothing tells the ramp its strings are colors.
function panelColor(colors: MapColors, settings: MapSettings): string | ExpressionSpecification {
  if (!settings.color_by) {
    return colors.color
  }

  const last = Math.max(1, colors.ramp.length - 1)
  const stops = colors.ramp.flatMap((color, index) => [index / last, ['to-color', color]])
  return expression([
    'case',
    ['has', SCALE],
    ['interpolate', ['linear'], ['get', SCALE], ...stops],
    colors.muted,
  ])
}

// tapet's layers for the panel's features: areas, lines and points, then their labels. A feature's
// simplestyle-spec properties (fill, stroke, marker-color…) win over the panel's colors, and a
// higher sort-key draws on top.
export function defaultLayers(colors: MapColors, settings: MapSettings): LayerSpecification[] {
  const color = panelColor(colors, settings)
  const sortKey = numberOr('sort-key', 0)
  const radius = expression([
    'match',
    ['get', 'marker-size'],
    ...Object.entries(MARKER_SIZES).flat(),
    numberOr('marker-size', MARKER_SIZES.medium),
  ])
  const areas = geometry('Polygon', 'MultiPolygon')
  const lines = geometry('LineString', 'MultiLineString')
  const points = geometry('Point', 'MultiPoint')
  const labeled = (kind: ExpressionSpecification) => expression(['all', ['has', 'label'], kind])
  // Without a base map the style has no fonts URL, so MapLibre draws labels in the window's own
  // font; base maps serve Noto Sans.
  const text = {
    'text-field': expression(['to-string', ['get', 'label']]),
    'text-font': settings.base_map === false ? ['system-ui'] : ['Noto Sans Regular'],
    'text-size': LABEL_SIZE,
    // A lower key places first, so the feature drawn on top keeps its label in a collision.
    'symbol-sort-key': expression(['-', 0, sortKey]),
  }
  const textPaint = {
    'text-color': colors.fg,
    'text-halo-color': colors.surface,
    'text-halo-width': 1.5,
  }
  return [
    {
      id: 'tapet-fill',
      type: 'fill',
      source: SOURCE,
      filter: areas,
      layout: { 'fill-sort-key': sortKey },
      paint: {
        'fill-color': colorOr('fill', color),
        'fill-opacity': numberOr('fill-opacity', 0.75),
      },
    },
    // A hairline in the surface color keeps neighboring areas apart.
    {
      id: 'tapet-outline',
      type: 'line',
      source: SOURCE,
      filter: areas,
      layout: { 'line-sort-key': sortKey },
      paint: {
        'line-color': colorOr('stroke', colors.surface),
        'line-width': numberOr('stroke-width', 0.75),
        'line-opacity': numberOr('stroke-opacity', 1),
      },
    },
    {
      id: 'tapet-line',
      type: 'line',
      source: SOURCE,
      filter: lines,
      layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': sortKey },
      paint: {
        'line-color': colorOr('stroke', color),
        'line-width': numberOr('stroke-width', 2),
        'line-opacity': numberOr('stroke-opacity', 1),
      },
    },
    {
      id: 'tapet-point',
      type: 'circle',
      source: SOURCE,
      filter: points,
      layout: { 'circle-sort-key': sortKey },
      paint: {
        'circle-color': colorOr('marker-color', color),
        'circle-radius': radius,
        'circle-stroke-color': colors.surface,
        'circle-stroke-width': 2,
      },
    },
    // Labels go in the middle of areas, along lines, and beside points, clear of the marker.
    {
      id: 'tapet-area-label',
      type: 'symbol',
      source: SOURCE,
      filter: labeled(areas),
      layout: text,
      paint: textPaint,
    },
    {
      id: 'tapet-line-label',
      type: 'symbol',
      source: SOURCE,
      filter: labeled(lines),
      layout: { ...text, 'symbol-placement': 'line-center' },
      paint: textPaint,
    },
    {
      id: 'tapet-point-label',
      type: 'symbol',
      source: SOURCE,
      filter: labeled(points),
      layout: {
        ...text,
        'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
        'text-radial-offset': expression(['/', ['+', radius, 4], LABEL_SIZE]),
        'text-justify': 'auto',
      },
      paint: textPaint,
    },
  ]
}

// The panel's layers: map.layers in place of tapet's own, each drawn from the panel's features.
export function layersOf(colors: MapColors, settings: MapSettings): LayerSpecification[] {
  if (!settings.layers) {
    return defaultLayers(colors, settings)
  }

  return settings.layers.map(
    (layer, index) =>
      ({ ...layer, id: `tapet-layer-${index}`, source: SOURCE }) as LayerSpecification,
  )
}

// A legend of categories, each with its color.
export interface CategoryLegend {
  title?: string
  items: Array<{ label: string; color: string }>
}

const COLOR_PAINT = ['fill-color', 'circle-color', 'line-color', 'fill-extrusion-color']

// The categories of a match on a property: ["match", ["get", field], value, color, …, fallback].
// Values listed together share a row, and the fallback is "other".
function matchLegend(value: unknown): CategoryLegend | undefined {
  if (!Array.isArray(value) || value[0] !== 'match' || value.length < 5) {
    return undefined
  }

  const [, input, ...cases] = value
  const fallback: unknown = cases.pop()
  const [operator, field]: unknown[] = Array.isArray(input) ? input : []
  if (operator !== 'get' || typeof field !== 'string') {
    return undefined
  }

  const items: CategoryLegend['items'] = []
  for (let index = 0; index + 1 < cases.length; index += 2) {
    const label: unknown = cases[index]
    const color: unknown = cases[index + 1]
    if (typeof color !== 'string') {
      return undefined
    }

    items.push({ label: Array.isArray(label) ? label.join(', ') : String(label), color })
  }

  if (typeof fallback === 'string') {
    items.push({ label: 'other', color: fallback })
  }

  return { title: field, items }
}

// The legend for categories: map.legend as given, or else the categories of the first of
// map.layers that colors features by a match on a property.
export function legendOf(settings: MapSettings): CategoryLegend | undefined {
  if (settings.legend) {
    return { items: settings.legend }
  }

  for (const layer of settings.layers ?? []) {
    for (const property of COLOR_PAINT) {
      const legend = matchLegend(layer.paint?.[property])
      if (legend) {
        return legend
      }
    }
  }

  return undefined
}

// The view shows one world, without copies beside it. The smallest zoom keeps the whole world inside
// the panel's shorter side, so the user can't zoom out into empty space. At zoom 0 the Mercator world
// is a 512 px square, and MapLibre allows no zoom below -2.
export function worldZoom(width: number, height: number): number {
  const side = Math.min(width, height)
  if (side <= 0) {
    return 0
  }

  return Math.max(-2, Math.log2(side / 512))
}

// Where the view may go, in place of MapLibre's own rule, which without world copies zooms in until the
// world fills the panel's width. A world smaller than the panel along an axis stays centered on it, with
// empty space around; a larger one can't be panned past its edges.
export function constrainWorld(
  center: { lng: number; lat: number },
  zoom: number,
  view: { width: number; height: number; minZoom: number; maxZoom: number },
): { lng: number; lat: number; zoom: number } {
  const clamped = Math.min(view.maxZoom, Math.max(view.minZoom, zoom))
  const size = 512 * 2 ** clamped
  const lng = ((((center.lng + 180) % 360) + 360) % 360) - 180
  const x = keepInside(((lng + 180) / 360) * size, size, view.width)
  const y = keepInside(mercatorY(center.lat) * size, size, view.height)
  return { lng: (x / size) * 360 - 180, lat: latitudeOf(y / size), zoom: clamped }
}

function keepInside(position: number, size: number, screen: number): number {
  if (size <= screen) {
    return size / 2
  }

  return Math.min(size - screen / 2, Math.max(screen / 2, position))
}

// A latitude's place on the Mercator world, from 0 at the top to 1 at the bottom.
function mercatorY(lat: number): number {
  const limited = Math.max(-85.051129, Math.min(85.051129, lat))
  return (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (limited * Math.PI) / 360))) / 360
}

function latitudeOf(y: number): number {
  return (360 / Math.PI) * Math.atan(Math.exp(((180 - y * 360) * Math.PI) / 180)) - 90
}
