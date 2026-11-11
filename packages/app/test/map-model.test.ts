import {
  Color,
  createExpression,
  latest,
  validateStyleMin,
  type StylePropertySpecification,
} from '@maplibre/maplibre-gl-style-spec'
import { expect, it } from 'vitest'
import type { Entry, MapSettings } from '@tapet/core'
import {
  SCALE,
  SOURCE,
  buildMap,
  constrainWorld,
  defaultLayers,
  labelField,
  legendOf,
  neutralize,
  worldZoom,
  type MapColors,
} from '../src/renderer/views/map/map-model.ts'

function entries(...values: unknown[]): Entry[] {
  return values.map((value, index) => ({ key: index + 1, seq: index + 1, receivedAt: 0, value }))
}

const point = (lon: number, lat: number, properties: Record<string, unknown> = {}) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lon, lat] },
  properties,
})

it('places features on the color_by scale, from the smallest value to the largest', () => {
  const { features, range } = buildMap(
    entries(
      point(0, 0, { votes: 10 }),
      point(1, 1, { votes: '30' }),
      point(2, 2, { votes: 'n/a' }),
    ),
    { color_by: 'votes' },
  )
  expect(range).toEqual([10, 30])
  expect(features.map((feature) => feature.properties[SCALE])).toEqual([0, 1, undefined])
})

it('leaves the panel data without tapet additions', () => {
  const item = point(0, 0, { votes: 1 })
  buildMap(entries(item), { color_by: 'votes' })
  expect(item.properties).toEqual({ votes: 1 })
})

it('finds the bounds of every coordinate, however nested', () => {
  const polygon = {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'GeometryCollection',
      geometries: [
        {
          type: 'MultiPolygon',
          coordinates: [
            [
              [
                [34, 29],
                [36, 29],
                [35, 33],
                [34, 29],
              ],
            ],
          ],
        },
        { type: 'Point', coordinates: [33.5, 31] },
      ],
    },
  }
  expect(buildMap(entries(polygon), {}).bounds).toEqual([
    [33.5, 29],
    [36, 33],
  ])
})

it('explains items that are not GeoJSON features', () => {
  expect(buildMap(entries({ lat: 1, lon: 2 }), {}).warning).toContain('must be GeoJSON features')
})

it('labels the base map in the chosen language, falling back to the local name', () => {
  expect(labelField('he')).toEqual([
    'coalesce',
    ['get', 'name:he'],
    ['get', 'name_he'],
    ['get', 'name'],
  ])
})

it('takes borders and the names of countries and regions off the base map', () => {
  const changes = neutralize([
    { id: 'water', 'source-layer': 'water' },
    { id: 'boundary_2', 'source-layer': 'boundary', filter: ['==', ['get', 'admin_level'], 2] },
    { id: 'label_city', 'source-layer': 'place', filter: ['==', ['get', 'class'], 'city'] },
  ])
  const political = [
    'match',
    ['get', 'class'],
    ['country', 'state', 'province', 'continent'],
    false,
    true,
  ]
  expect(changes).toEqual([
    { id: 'boundary_2', hide: true },
    { id: 'label_city', filter: ['all', ['==', ['get', 'class'], 'city'], political] },
  ])
})

const colors: MapColors = {
  color: '#2a78d6',
  fg: '#1d1d1f',
  muted: '#6e6e73',
  surface: '#ffffff',
  ramp: ['#cde2fb', '#0d366b'],
}

// A paint property of one of tapet's layers, as MapLibre computes it for a feature.
function paint(
  settings: MapSettings,
  layerId: string,
  property: string,
  properties: Record<string, unknown>,
): unknown {
  const layer = defaultLayers(colors, settings).find((candidate) => candidate.id === layerId)
  const value = (layer?.paint as Record<string, unknown> | undefined)?.[property]
  const specs = latest as unknown as Record<string, Record<string, StylePropertySpecification>>
  const parsed = createExpression(value, property, specs[`paint_${layer?.type}`]?.[property])
  if (parsed.result === 'error') {
    throw new Error(parsed.value.map((error) => error.message).join('; '))
  }

  const result: unknown = parsed.value.evaluate({ zoom: 10 }, { type: 'Point', properties })
  return result instanceof Color ? result.toString() : result
}

const rgba = (color: string) => Color.parse(color)?.toString()

it('builds layers MapLibre accepts', () => {
  const source = { type: 'geojson' as const, data: { type: 'FeatureCollection', features: [] } }
  for (const settings of [{}, { color_by: 'votes' }, { base_map: false as const }]) {
    const style = { version: 8 as const, sources: { [SOURCE]: source }, layers: [] }
    expect(validateStyleMin({ ...style, layers: defaultLayers(colors, settings) })).toEqual([])
  }
})

it("sizes points by simplestyle's marker-size, a name or pixels", () => {
  const radius = (size?: unknown) =>
    paint({}, 'tapet-point', 'circle-radius', size === undefined ? {} : { 'marker-size': size })
  expect([radius('small'), radius('medium'), radius('large')]).toEqual([3.5, 5, 8])
  expect(radius(12)).toBe(12)
  expect(radius()).toBe(5)
  expect(radius('huge')).toBe(5)
})

it("lets a feature's own colors win over the panel's", () => {
  const byVotes = { color_by: 'votes' }
  const point = (properties: Record<string, unknown>) =>
    paint(byVotes, 'tapet-point', 'circle-color', properties)
  expect(point({ 'marker-color': '#ff0000', [SCALE]: 1 })).toBe(rgba('#ff0000'))
  expect(point({ [SCALE]: 0 })).toBe(rgba('#cde2fb'))
  expect(point({ 'marker-color': 'not a color', [SCALE]: 1 })).toBe(rgba('#0d366b'))
  expect(point({})).toBe(rgba('#6e6e73'))
  expect(paint({}, 'tapet-fill', 'fill-color', { fill: 'green' })).toBe(rgba('green'))
  expect(paint({}, 'tapet-fill', 'fill-color', {})).toBe(rgba('#2a78d6'))
  expect(paint({}, 'tapet-fill', 'fill-opacity', { 'fill-opacity': 0.2 })).toBe(0.2)
  expect(paint({}, 'tapet-line', 'line-color', { stroke: '#123456' })).toBe(rgba('#123456'))
})

it('reads a legend from a layer that colors by a match on a property, unless map.legend is set', () => {
  const color = ['match', ['get', 'party'], 'A', '#ff0000', ['B', 'C'], '#0000ff', '#999999']
  const layers = [
    { type: 'circle' as const, paint: { 'circle-radius': 4 } },
    { type: 'circle' as const, paint: { 'circle-color': color } },
  ]
  expect(legendOf({ layers })).toEqual({
    title: 'party',
    items: [
      { label: 'A', color: '#ff0000' },
      { label: 'B, C', color: '#0000ff' },
      { label: 'other', color: '#999999' },
    ],
  })
  const legend = [{ label: 'Party A', color: 'red' }]
  expect(legendOf({ layers, legend })).toEqual({ items: legend })
  expect(legendOf({ layers: [{ type: 'fill', paint: { 'fill-color': 'red' } }] })).toBeUndefined()
  expect(legendOf({ color_by: 'votes' })).toBeUndefined()
})

it('lets a wide panel zoom out until the whole world fits its height', () => {
  expect(worldZoom(1800, 512)).toBe(0)
  expect(worldZoom(1024, 2048)).toBe(1)
  expect(worldZoom(40, 40)).toBe(-2)
  expect(worldZoom(0, 300)).toBe(0)
})

const wide = { width: 1800, height: 512, minZoom: 0, maxZoom: 22 }

it('keeps a world narrower than the panel centered, with empty space beside it', () => {
  const view = constrainWorld({ lng: 120, lat: 60 }, 0, wide)
  expect(view.lng).toBeCloseTo(0)
  expect(view.lat).toBeCloseTo(0)
  expect(view.zoom).toBe(0)
})

it("doesn't zoom out past the whole world", () => {
  expect(constrainWorld({ lng: 0, lat: 0 }, -1, wide).zoom).toBe(0)
})

it('stops a world bigger than the panel from panning past its edges', () => {
  // At zoom 3 the world is 4096 px: the panel's 1800 px fit inside it across, its 512 px up and down.
  const north = constrainWorld({ lng: 0, lat: 89 }, 3, wide)
  const top = constrainWorld({ lng: 0, lat: north.lat + 1 }, 3, wide)
  expect(north.lat).toBeLessThan(85.06)
  expect(top.lat).toBeCloseTo(north.lat)

  const east = constrainWorld({ lng: 179, lat: 0 }, 3, wide)
  expect(east.lng).toBeCloseTo(180 - (900 / 4096) * 360)
})

it('keeps a point the user pans to when it is inside the world', () => {
  const view = constrainWorld({ lng: 10, lat: 45 }, 4, wide)
  expect(view.lng).toBeCloseTo(10)
  expect(view.lat).toBeCloseTo(45)
})
