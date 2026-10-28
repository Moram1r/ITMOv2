import type { GraphDisplayLimits, GraphLimits } from './graph/types'

export const LIMITS = {
  maxZipBytes: 20 * 1024 * 1024, // 20 MiB
  maxEntries: 2000, // including folders
  maxUncompressedBytes: 100 * 1024 * 1024, // 100 MiB
} as const

export type Limits = typeof LIMITS

export const GRAPH_LIMITS: GraphLimits = {
  maxFileBytes: 1 * 1024 * 1024, // 1 MiB, мягкий лимит
  maxTextBytes: 20 * 1024 * 1024, // 20 MiB, жёсткий лимит
  maxNodes: 3000,
  maxEdges: 10000,
}

export const GRAPH_DISPLAY_LIMITS: GraphDisplayLimits = {
  comfortableNodes: 200,
  comfortableEdges: 500,
  maxInteractiveNodes: 1000,
  maxInteractiveEdges: 3000,
}
