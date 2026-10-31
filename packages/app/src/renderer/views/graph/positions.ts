// Where nodes start. Known nodes keep their place across updates, so the layout doesn't jump;
// new nodes start next to a neighbor that has one.
import { Graph, layout } from '@dagrejs/dagre'
import type { GraphData } from './graph-model.ts'

export type Point = [number, number]

// The hierarchical layout lays out at most this many nodes; beyond that it would take too long.
export const HIERARCHICAL_LIMIT = 3000

export function placePoints(
  data: GraphData,
  previous: ReadonlyMap<string, Point>,
  center: Point,
  random: () => number = Math.random,
): Float32Array {
  const positions = new Float32Array(data.nodes.length * 2).fill(Number.NaN)
  const placed = (index: number) => !Number.isNaN(positions[index * 2] ?? Number.NaN)
  const place = (index: number, [x, y]: Point) => {
    positions[index * 2] = x
    positions[index * 2 + 1] = y
  }

  data.nodes.forEach((node, index) => {
    const point = previous.get(node.id)
    if (point) {
      place(index, point)
    }
  })

  // Twice through the edges, so nodes two steps from a placed one get placed too.
  for (let pass = 0; pass < 2; pass += 1) {
    for (let at = 0; at < data.links.length; at += 2) {
      const source = data.links[at] ?? 0
      const target = data.links[at + 1] ?? 0
      const [from, to] = placed(source) ? [source, target] : [target, source]
      if (placed(from) && !placed(to)) {
        place(to, [
          (positions[from * 2] ?? 0) + (random() - 0.5) * 20,
          (positions[from * 2 + 1] ?? 0) + (random() - 0.5) * 20,
        ])
      }
    }
  }

  // The rest start scattered around the center, in an area that grows with their number.
  const spread = 10 * Math.sqrt(data.nodes.length)
  for (let index = 0; index < data.nodes.length; index += 1) {
    if (!placed(index)) {
      place(index, [center[0] + (random() - 0.5) * spread, center[1] + (random() - 0.5) * spread])
    }
  }

  return positions
}

// Layered positions for hierarchies (dependencies, state machines), top to bottom.
export function hierarchicalPositions(data: GraphData, sizes: Float32Array): Float32Array {
  const graph = new Graph({ multigraph: true })
  graph.setGraph({ rankdir: 'TB', nodesep: 24, ranksep: 48 })
  graph.setDefaultEdgeLabel(() => ({}))
  data.nodes.forEach((_, index) => {
    const size = sizes[index] ?? 6
    graph.setNode(String(index), { width: size * 3, height: size * 3 })
  })

  for (let at = 0; at < data.links.length; at += 2) {
    graph.setEdge(String(data.links[at]), String(data.links[at + 1]), {}, String(at))
  }

  layout(graph)
  const positions = new Float32Array(data.nodes.length * 2)
  data.nodes.forEach((_, index) => {
    const { x = 0, y = 0 } = graph.node(String(index)) ?? {}
    positions[index * 2] = x
    // dagre's y grows downward; the graph's space grows upward.
    positions[index * 2 + 1] = -y
  })
  return positions
}
