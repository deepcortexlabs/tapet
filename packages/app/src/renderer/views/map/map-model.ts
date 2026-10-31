// The map view's features, without any DOM, so it's tested on its own: GeoJSON features, where each
// falls on the color_by scale, and the bounds the view first zooms to.
import type { Entry, MapSettings } from '@tapet/core'

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
