import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type EdgeMouseHandler,
  type Node,
  type NodeMouseHandler,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type {
  GraphEdge,
  GraphNode,
  GraphResult,
  GraphSelection,
} from '../lib/graph'
import { layoutGraph, reduceGraph } from '../lib/graph/layout'
import {
  EDGE_KIND_LABEL,
  NODE_KIND_LABEL,
  STATUS_LABEL,
} from './graph-labels'

export type GraphViewProps = {
  result: GraphResult
  selection: GraphSelection
  mode: 'full' | 'reduced'
  onSelect: (selection: GraphSelection) => void
  onShowInTable: (tablePath: string) => void
}

type GraphNodeData = {
  node: GraphNode
}

type FlowNode = Node<GraphNodeData, 'graphNode'>

function edgeColor(edge: GraphEdge): string {
  if (edge.certainty === 'conditional') return '#f2b84b'
  switch (edge.kind) {
    case 'project-reference':
      return '#3aa8ff'
    case 'package-reference':
      return '#b48cff'
    default:
      return '#54d6b0'
  }
}

function edgeHighlightColor(edge: GraphEdge): string {
  if (edge.certainty === 'conditional') return '#ffd166'
  switch (edge.kind) {
    case 'project-reference':
      return '#9bd7ff'
    case 'package-reference':
      return '#d8c4ff'
    default:
      return '#a9f0dc'
  }
}

function GraphNodeCard({ data }: NodeProps<FlowNode>) {
  const { node } = data
  const meta =
    node.kind === 'project'
      ? node.targetFrameworks.length > 0
        ? node.targetFrameworks.join(', ')
        : 'TFM не указан'
      : node.kind === 'source'
        ? node.namespaces.length > 0
          ? node.namespaces.join(', ')
          : 'без namespace'
        : `версии: ${
            node.versions.length > 0
              ? node.versions.map((version) => version ?? '—').join(', ')
              : 'не указаны'
          }`

  return (
    <div className={`gnode gnode--${node.kind}`}>
      <Handle
        type="target"
        position={Position.Left}
        className="gnode__handle"
        isConnectable={false}
      />
      <div className="gnode__top">
        <span className={`gnode__kind gnode__kind--${node.kind}`}>
          {NODE_KIND_LABEL[node.kind]}
        </span>
        <span
          className={`gnode__status gnode__status--${node.status}`}
          title={`Статус: ${STATUS_LABEL[node.status]}`}
        >
          <span className="gnode__dot" aria-hidden="true" />
          {STATUS_LABEL[node.status]}
        </span>
      </div>
      <div className="gnode__label" title={node.label}>
        {node.label}
      </div>
      <div className="gnode__meta" title={meta}>
        {meta}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="gnode__handle"
        isConnectable={false}
      />
    </div>
  )
}

const nodeTypes = { graphNode: GraphNodeCard }

export function GraphView({
  result,
  selection,
  mode,
  onSelect,
  onShowInTable,
}: GraphViewProps) {
  const keyboardFocusRef = useRef<{
    kind: 'node' | 'edge'
    id: string
  } | null>(null)

  const display = useMemo(
    () =>
      mode === 'reduced'
        ? reduceGraph(result.nodes, result.edges)
        : { nodes: result.nodes, edges: result.edges },
    [mode, result.edges, result.nodes]
  )

  const labels = useMemo(
    () => new Map(result.nodes.map((node) => [node.id, node.label])),
    [result.nodes]
  )

  const positions = useMemo(
    () => layoutGraph(display.nodes, display.edges),
    [display.edges, display.nodes]
  )

  const flowNodes = useMemo<FlowNode[]>(
    () =>
      display.nodes.map((node) => ({
        id: node.id,
        type: 'graphNode',
        position: positions.get(node.id) ?? { x: 0, y: 0 },
        data: { node },
        selected: selection?.kind === 'node' && selection.id === node.id,
        draggable: true,
        ariaLabel: `${NODE_KIND_LABEL[node.kind]} ${node.label}. Статус: ${STATUS_LABEL[node.status]}.`,
      })),
    [display.nodes, positions, selection]
  )

  const flowEdges = useMemo<Edge[]>(
    () =>
      display.edges.map((edge) => {
        const selected = selection?.kind === 'edge' && selection.id === edge.id
        const connected =
          selection?.kind === 'node' &&
          (edge.from === selection.id || edge.to === selection.id)
        const dimmed = selection?.kind === 'node' && !connected
        const conditional = edge.certainty === 'conditional'
        const color = edgeColor(edge)
        const highlightedColor = connected ? edgeHighlightColor(edge) : color
        const from = labels.get(edge.from) ?? edge.from
        const to = labels.get(edge.to) ?? edge.to
        return {
          id: edge.id,
          source: edge.from,
          target: edge.to,
          type: 'smoothstep',
          selected,
          className: connected
            ? 'graph-edge graph-edge--connected'
            : dimmed
              ? 'graph-edge graph-edge--dimmed'
              : 'graph-edge',
          label: conditional ? 'условная' : undefined,
          labelStyle: {
            fill: '#f2b84b',
            fontSize: 11,
            fontWeight: 600,
          },
          labelBgStyle: { fill: '#14181d', fillOpacity: 0.92 },
          labelBgPadding: [4, 2],
          labelBgBorderRadius: 4,
          style: {
            stroke: selected ? color : highlightedColor,
            strokeWidth: selected ? 3 : connected ? 3 : 1.6,
            strokeDasharray: conditional ? '6 4' : undefined,
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: highlightedColor,
            width: connected ? 18 : 16,
            height: connected ? 18 : 16,
          },
          data: { edge },
          interactionWidth: 24,
          ariaLabel: `${EDGE_KIND_LABEL[edge.kind]}: ${from} → ${to}${
            conditional ? ', условная' : ''
          }${connected ? ', связана с выбранным узлом' : ''}.`,
        }
      }),
    [display.edges, labels, selection]
  )

  const handleNodeClick: NodeMouseHandler<FlowNode> = useCallback(
    (_event, node) => {
      onSelect({ kind: 'node', id: node.id })
    },
    [onSelect]
  )

  const handleEdgeClick: EdgeMouseHandler = useCallback(
    (_event, edge) => {
      onSelect({ kind: 'edge', id: edge.id })
    },
    [onSelect]
  )

  const handleNodeDoubleClick: NodeMouseHandler<FlowNode> = useCallback(
    (_event, node) => {
      const original = node.data.node
      if (original.kind !== 'package' && original.tablePath !== null) {
        onShowInTable(original.tablePath)
      }
    },
    [onShowInTable]
  )

  const handleKeyDownCapture = useCallback(
    (event: React.KeyboardEvent) => {
      if (
        event.key !== 'Enter' &&
        event.key !== ' ' &&
        event.key !== 'Escape'
      ) {
        return
      }

      const target = event.target as HTMLElement
      const element = target.closest<HTMLElement>(
        '.react-flow__node[data-id], .react-flow__edge[data-id]'
      )

      if (!element) {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onSelect(null)
        }
        return
      }

      // React Flow по-разному обрабатывает Enter, Space и Escape. Берём
      // клавиатурный выбор на себя, чтобы поведение было предсказуемым.
      event.preventDefault()
      event.stopPropagation()

      const id = element.dataset.id
      if (!id) return
      const kind = element.classList.contains('react-flow__node')
        ? 'node'
        : 'edge'

      // React Flow пересоздаёт SVG-элемент ребра при смене selected,
      // поэтому после коммита возвращаем фокус новому элементу.
      keyboardFocusRef.current = { kind, id }
      onSelect(event.key === 'Escape' ? null : { kind, id })
    },
    [onSelect]
  )

  useEffect(() => {
    const pending = keyboardFocusRef.current
    if (!pending) return
    keyboardFocusRef.current = null
    const selector =
      pending.kind === 'node'
        ? '.react-flow__node[data-id]'
        : '.react-flow__edge[data-id]'
    const timer = window.setTimeout(() => {
      for (const candidate of Array.from(
        document.querySelectorAll<HTMLElement>(selector)
      )) {
        if (candidate.dataset.id === pending.id) {
          candidate.focus({ preventScroll: true })
          return
        }
      }
    }, 0)
    return () => window.clearTimeout(timer)
  }, [selection])

  return (
    <div
      className="graph-flow"
      aria-label="Интерактивный граф зависимостей"
      onKeyDownCapture={handleKeyDownCapture}
    >
      <div className="graph-flow__canvas">
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          onNodeClick={handleNodeClick}
          onNodeDoubleClick={handleNodeDoubleClick}
          onEdgeClick={handleEdgeClick}
          onPaneClick={() => onSelect(null)}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.2}
          maxZoom={1.8}
          nodesConnectable={false}
          nodesDraggable
          elementsSelectable
          edgesFocusable
          nodesFocusable
          multiSelectionKeyCode={null}
          selectionOnDrag={false}
          zoomOnDoubleClick={false}
          proOptions={{ hideAttribution: false }}
          aria-label="Граф зависимостей C#-проекта"
        >
          <Background gap={24} size={1} color="#263141" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <p className="graph-flow__hint">
        Tab — переход между узлами и связями, Enter или Space — выбрать, Esc —
        снять выбор. При выборе узла его входящие и исходящие связи
        подсвечиваются. Двойной щелчок по проекту или файлу открывает его в
        таблице.
      </p>
    </div>
  )
}

export default GraphView
