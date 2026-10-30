export type NodeStatus = 'known' | 'partial' | 'unknown'

export type GraphNodeBase = {
  id: string
  label: string
  status: NodeStatus
}

export type ProjectNode = GraphNodeBase & {
  kind: 'project'
  path: string
  tablePath: string | null
  name: string
  targetFrameworks: string[]
  sourceFileIds: string[]
}

export type SourceFileNode = GraphNodeBase & {
  kind: 'source'
  path: string
  tablePath: string | null
  projectId: string | null
  namespaces: string[]
  usingCount: number
}

export type ExternalPackageNode = GraphNodeBase & {
  kind: 'package'
  packageId: string
  versions: Array<string | null>
}

export type GraphNode = ProjectNode | SourceFileNode | ExternalPackageNode

export type EdgeKind = 'project-reference' | 'package-reference' | 'using'
export type EdgeCertainty = 'declared' | 'namespace-match' | 'conditional'

export type GraphEdge = {
  id: string
  from: string
  to: string
  kind: EdgeKind
  certainty: EdgeCertainty
  namespace?: string
  packageVersion?: string | null
  condition?: string | null
}

export type UnresolvedReason =
  | 'EXTERNAL_NAMESPACE'
  | 'NAMESPACE_NOT_FOUND'
  | 'NAMESPACE_CASE_MISMATCH'
  | 'STATIC_USING_UNSUPPORTED'
  | 'ALIAS_TARGET_UNSUPPORTED'
  | 'PROJECT_NOT_FOUND'

export type UnresolvedItem = {
  id: string
  kind: 'using' | 'project-reference'
  reason: UnresolvedReason
  fromId: string
  target: string
  candidates: string[]
  count: number
  message: string
}

export type GraphWarningCode =
  | 'FILE_TOO_LARGE'
  | 'DUPLICATE_PATH'
  | 'MULTIPLE_PROJECTS_IN_DIR'
  | 'EMPTY_NAMESPACE'
  | 'PARSE_ISSUE'

export type GraphWarning = {
  code: GraphWarningCode
  message: string
  paths: string[]
  count: number
}

export type GraphStats = {
  projectCount: number
  sourceFileCount: number
  packageCount: number
  nodeCount: number
  edgeCount: number
  namespaceCount: number
  systemUsingCount: number
  externalUsingCount: number
  unresolvedCount: number
  excluded: {
    objBin: number
    otherTypes: number
    total: number
  }
}

export type GraphResult = {
  archiveName: string
  nodes: GraphNode[]
  edges: GraphEdge[]
  unresolved: UnresolvedItem[]
  stats: GraphStats
  warnings: GraphWarning[]
}

export type GraphLimits = {
  maxFileBytes: number
  maxTextBytes: number
  maxNodes: number
  maxEdges: number
}

export type GraphDisplayLimits = {
  comfortableNodes: number
  comfortableEdges: number
  maxInteractiveNodes: number
  maxInteractiveEdges: number
}

export type GraphStatus =
  | 'notStarted'
  | 'building'
  | 'done'
  | 'empty'
  | 'error'
  | 'limit'

export type GraphSelection =
  | { kind: 'node'; id: string }
  | { kind: 'edge'; id: string }
  | { kind: 'unresolved'; id: string }
  | null

// Внутренние типы модуля. Не реэкспортируются из публичного index.ts.
export type ZipSourceFile = {
  originalPath: string
  path: string
  ext: 'cs' | 'csproj'
  size: number
}

export type ReadSourceFile = ZipSourceFile & {
  text: string | null
  status: NodeStatus
}

export type UsingRef = {
  target: string
  isStatic: boolean
  alias: string | null
  scopeNamespace: string | null
  line: number
}

export type ParsedCsFile = {
  namespaces: string[]
  usings: UsingRef[]
  issue: string | null
}

export type ProjectRef = {
  include: string
  condition: string | null
}

export type PackageRef = {
  id: string
  version: string | null
  condition: string | null
}

export type ParsedProjectFile = {
  name: string
  targetFrameworks: string[]
  projectRefs: ProjectRef[]
  packageRefs: PackageRef[]
  issue: string | null
}
