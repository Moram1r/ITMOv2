import { GRAPH_DISPLAY_LIMITS } from '../limits'
import { byteCompare } from './paths'
import type {
  GraphDisplayLimits,
  GraphEdge,
  GraphNode,
} from './types'

export type LayoutPosition = { x: number; y: number }

export type GraphDegrees = {
  incoming: Map<string, number>
  outgoing: Map<string, number>
}

export type DisplayMode = 'full' | 'reduced' | 'listOnly'

export type ReducedGraph = {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export function graphDegrees(
  nodes: GraphNode[],
  edges: GraphEdge[]
): GraphDegrees {
  const incoming = new Map<string, number>()
  const outgoing = new Map<string, number>()
  for (const node of nodes) {
    incoming.set(node.id, 0)
    outgoing.set(node.id, 0)
  }
  for (const edge of edges) {
    if (!incoming.has(edge.from) || !incoming.has(edge.to)) continue
    outgoing.set(edge.from, (outgoing.get(edge.from) ?? 0) + 1)
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1)
  }
  return { incoming, outgoing }
}

export function graphDisplayMode(
  nodes: GraphNode[],
  edges: GraphEdge[],
  limits: GraphDisplayLimits = GRAPH_DISPLAY_LIMITS
): DisplayMode {
  if (
    nodes.length > limits.maxInteractiveNodes ||
    edges.length > limits.maxInteractiveEdges
  ) {
    return 'listOnly'
  }
  if (
    nodes.length > limits.comfortableNodes ||
    edges.length > limits.comfortableEdges
  ) {
    return 'reduced'
  }
  return 'full'
}

/**
 * Детерминированно оставляет не более comfortableNodes узлов с наибольшей
 * суммарной степенью и не более comfortableEdges связей между ними.
 */
export function reduceGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  limits: GraphDisplayLimits = GRAPH_DISPLAY_LIMITS
): ReducedGraph {
  const { incoming, outgoing } = graphDegrees(nodes, edges)
  const degree = (id: string) =>
    (incoming.get(id) ?? 0) + (outgoing.get(id) ?? 0)

  const selected = [...nodes]
    .sort((a, b) => degree(b.id) - degree(a.id) || byteCompare(a.id, b.id))
    .slice(0, limits.comfortableNodes)
  const selectedIds = new Set(selected.map((node) => node.id))

  const selectedEdges = edges
    .filter((edge) => selectedIds.has(edge.from) && selectedIds.has(edge.to))
    .sort(
      (a, b) =>
        degree(b.from) +
          degree(b.to) -
          (degree(a.from) + degree(a.to)) ||
        byteCompare(a.id, b.id)
    )
    .slice(0, limits.comfortableEdges)
    .sort((a, b) => byteCompare(a.id, b.id))

  return {
    nodes: nodes.filter((node) => selectedIds.has(node.id)),
    edges: selectedEdges,
  }
}

/**
 * Слоистая раскладка BFS. Корни — узлы без входящих рёбер; циклы обходятся
 * повторным запуском от наименьшего непосещённого id. Глубина фиксируется
 * при первом посещении.
 */
export function layoutGraph(
  nodes: GraphNode[],
  edges: GraphEdge[]
): Map<string, LayoutPosition> {
  const ids = nodes.map((node) => node.id).sort(byteCompare)
  const idSet = new Set(ids)
  const outgoing = new Map<string, string[]>()
  const incomingCount = new Map<string, number>()
  for (const id of ids) {
    outgoing.set(id, [])
    incomingCount.set(id, 0)
  }
  for (const edge of edges) {
    if (!idSet.has(edge.from) || !idSet.has(edge.to)) continue
    outgoing.get(edge.from)!.push(edge.to)
    incomingCount.set(edge.to, (incomingCount.get(edge.to) ?? 0) + 1)
  }
  for (const targets of outgoing.values()) targets.sort(byteCompare)

  const depth = new Map<string, number>()
  const visited = new Set<string>()
  const bfs = (start: string) => {
    const queue: Array<{ id: string; depth: number }> = [
      { id: start, depth: 0 },
    ]
    let head = 0
    while (head < queue.length) {
      const item = queue[head++]
      if (visited.has(item.id)) continue
      visited.add(item.id)
      depth.set(item.id, item.depth)
      for (const target of outgoing.get(item.id) ?? []) {
        if (!visited.has(target)) {
          queue.push({ id: target, depth: item.depth + 1 })
        }
      }
    }
  }

  for (const id of ids) {
    if ((incomingCount.get(id) ?? 0) === 0 && !visited.has(id)) bfs(id)
  }
  for (const id of ids) {
    if (!visited.has(id)) bfs(id)
  }

  const layers = new Map<number, string[]>()
  for (const id of ids) {
    const layer = depth.get(id) ?? 0
    const list = layers.get(layer)
    if (list) list.push(id)
    else layers.set(layer, [id])
  }
  for (const list of layers.values()) list.sort(byteCompare)

  const positions = new Map<string, LayoutPosition>()
  for (const [layer, list] of layers) {
    list.forEach((id, index) => {
      positions.set(id, { x: layer * 280, y: index * 96 })
    })
  }
  return positions
}
