import { expect, it } from 'vitest'
import type { Entry } from '@tapet/core'
import { SCALE, buildMap, labelField, neutralize } from '../src/renderer/views/map/map-model.ts'

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
