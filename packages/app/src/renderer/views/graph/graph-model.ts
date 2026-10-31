// The graph view's nodes and edges, without any DOM, so it's tested on its own. Items with
// source and target fields are edges; the others are nodes. Nodes that edges mention but no item
// defines are created from the edges alone, so a plain edge list is a graph.
import type { Entry, GraphSettings } from '@tapet/core'

export interface GraphNode {
  id: string
  // The node's own item; absent for nodes that only edges mention.
  item?: Record<string, unknown>
  label: string
  // The value of the graph.color field, which picks the node's color.
  group?: string
  // The value of the graph.size field.
  size?: number
}

export interface GraphData {
  nodes: GraphNode[]
  // Pairs of node indices: [source, target, source, target, …].
  links: Uint32Array
  // The distinct graph.color values, in order of first appearance.
  groups: string[]
  // A problem with some of the items, e.g. items that are neither nodes nor edges.
  warning?: string
}

export interface Fields {
  id: string
  source: string
  target: string
}

export function fieldsOf(settings: GraphSettings): Fields {
  return {
    id: settings.id ?? 'id',
    source: settings.source ?? 'source',
    target: settings.target ?? 'target',
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null && value !== ''
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function toNumber(value: unknown): number | undefined {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return typeof number === 'number' && Number.isFinite(number) ? number : undefined
}

export function buildGraph(entries: Entry[], settings: GraphSettings): GraphData {
  const fields = fieldsOf(settings)
  const nodes: GraphNode[] = []
  const indexes = new Map<string, number>()
  const groups: string[] = []
  const links: number[] = []
  let warning: string | undefined

  function nodeIndex(id: string): number {
    const existing = indexes.get(id)
    if (existing !== undefined) {
      return existing
    }

    indexes.set(id, nodes.length)
    nodes.push({ id, label: id })
    return nodes.length - 1
  }

  for (const { value: item } of entries) {
    if (!isRecord(item)) {
      warning ??= 'graph items must be JSON objects: use ndjson, or csv with a header'
      continue
    }

    if (isPresent(item[fields.source]) && isPresent(item[fields.target])) {
      links.push(nodeIndex(text(item[fields.source])), nodeIndex(text(item[fields.target])))
      continue
    }

    if (!isPresent(item[fields.id])) {
      warning ??= `items need an id field ("${fields.id}"), or source and target fields ("${fields.source}", "${fields.target}")`
      continue
    }

    // A later item for the same node replaces the earlier one.
    const node = nodes[nodeIndex(text(item[fields.id]))] as GraphNode
    node.item = item
    node.label =
      settings.label && isPresent(item[settings.label]) ? text(item[settings.label]) : node.id
    node.group =
      settings.color && isPresent(item[settings.color]) ? text(item[settings.color]) : undefined
    node.size = settings.size ? toNumber(item[settings.size]) : undefined
  }

  for (const node of nodes) {
    if (node.group !== undefined && !groups.includes(node.group)) {
      groups.push(node.group)
    }
  }

  const data = { nodes, links: Uint32Array.from(links), groups }
  return warning ? { ...data, warning } : data
}

// Each node's number of edges.
export function degrees(data: GraphData): Uint32Array {
  const counts = new Uint32Array(data.nodes.length)
  for (const index of data.links) {
    counts[index] = (counts[index] ?? 0) + 1
  }

  return counts
}

// Point sizes in pixels: graph.size values on a square-root scale, so areas follow the values.
// Without sizes, nodes are smaller the more of them there are.
export function pointSizes(data: GraphData, range: [number, number] = [3, 16]): Float32Array {
  const values = data.nodes.map((node) => node.size)
  const known = values.filter((value): value is number => value !== undefined && value >= 0)
  const plain = data.nodes.length <= 1000 ? 6 : data.nodes.length <= 100_000 ? 3 : 2
  if (known.length === 0) {
    return new Float32Array(data.nodes.length).fill(plain)
  }

  const [smallest, largest] = range
  // A loop rather than Math.max(...known), which overflows the stack on a million nodes.
  let max = 0
  for (const value of known) {
    max = Math.max(max, Math.sqrt(value))
  }

  return Float32Array.from(values, (value) =>
    value === undefined || value < 0 || max === 0
      ? smallest
      : smallest + (largest - smallest) * (Math.sqrt(value) / max),
  )
}

// Which nodes may get labels, most important first: larger, then better connected. Labels for
// all of a huge graph's nodes would cost more than they help.
export const LABEL_CANDIDATES = 300

export function labelOrder(data: GraphData, limit = LABEL_CANDIDATES): number[] {
  const degree = degrees(data)
  const sizes = pointSizes(data)
  return Array.from(data.nodes.keys())
    .sort((a, b) => (sizes[b] ?? 0) - (sizes[a] ?? 0) || (degree[b] ?? 0) - (degree[a] ?? 0))
    .slice(0, limit)
}
