import { expect, it } from 'vitest'
import type { Entry } from '@tapet/core'
import { buildGraph, labelOrder, pointSizes } from '../src/renderer/views/graph/graph-model.ts'
import { placeLabels } from '../src/renderer/views/graph/labels.ts'
import { hierarchicalPositions, placePoints } from '../src/renderer/views/graph/positions.ts'

function entries(...values: unknown[]): Entry[] {
  return values.map((value, index) => ({ key: index + 1, seq: index + 1, receivedAt: 0, value }))
}

it('makes a graph from a plain edge list, creating the nodes the edges mention', () => {
  const data = buildGraph(entries({ source: 'a', target: 'b' }, { source: 'b', target: 'c' }), {})
  expect(data.nodes.map((node) => node.id)).toEqual(['a', 'b', 'c'])
  expect([...data.links]).toEqual([0, 1, 1, 2])
})

it('reads nodes and edges by the configured fields, and a later node item replaces an earlier one', () => {
  const data = buildGraph(
    entries(
      { key: 'a', name: 'Alpha', team: 'web', load: 1 },
      { from: 'a', to: 'b' },
      { key: 'a', name: 'Alpha 2', team: 'data', load: 4 },
    ),
    { id: 'key', source: 'from', target: 'to', label: 'name', color: 'team', size: 'load' },
  )
  expect(data.nodes).toEqual([
    {
      id: 'a',
      item: { key: 'a', name: 'Alpha 2', team: 'data', load: 4 },
      label: 'Alpha 2',
      group: 'data',
      size: 4,
    },
    { id: 'b', label: 'b' },
  ])
  expect(data.groups).toEqual(['data'])
})

it('explains items that are neither nodes nor edges', () => {
  expect(buildGraph(entries({ name: 'x' }), {}).warning).toBe(
    'items need an id field ("id"), or source and target fields ("source", "target")',
  )
  expect(buildGraph(entries(['a', 'b']), {}).warning).toContain('must be JSON objects')
})

it('sizes points by the square root of graph.size, so areas follow the values', () => {
  const data = buildGraph(entries({ id: 'a', n: 100 }, { id: 'b', n: 25 }, { id: 'c' }), {
    size: 'n',
  })
  expect([...pointSizes(data, [2, 12])]).toEqual([12, 7, 2])
})

it('offers labels to the largest, then best connected nodes', () => {
  const data = buildGraph(
    entries({ source: 'a', target: 'b' }, { source: 'c', target: 'b' }, { id: 'd' }),
    {},
  )
  expect(labelOrder(data, 2)).toEqual([1, 0])
})

it('keeps known nodes in place and starts new ones next to a neighbor', () => {
  const data = buildGraph(entries({ source: 'a', target: 'b' }, { id: 'c' }), {})
  const positions = placePoints(data, new Map([['a', [100, 100]]]), [0, 0], () => 0.5)
  expect([...positions]).toEqual([100, 100, 100, 100, 0, 0])
})

it('lays out hierarchies top to bottom', () => {
  const data = buildGraph(entries({ source: 'a', target: 'b' }, { source: 'b', target: 'c' }), {})
  const positions = hierarchicalPositions(data, new Float32Array([6, 6, 6]))
  const [, a = 0, , b = 0, , c = 0] = positions
  expect(a).toBeGreaterThan(b)
  expect(b).toBeGreaterThan(c)
})

it('places labels most important first, without overlaps, inside the view', () => {
  const box = (x: number, y: number) => ({ x, y, width: 50, height: 16 })
  const bounds = { width: 300, height: 200 }
  expect(
    placeLabels([box(10, 10), box(30, 15), box(200, 10), box(280, 10), undefined], bounds),
  ).toEqual([0, 2])
  // With cells, a second label in the same cell waits even when it doesn't overlap.
  expect(placeLabels([box(10, 10), box(10, 30)], bounds, { width: 120, height: 48 })).toEqual([0])
})
