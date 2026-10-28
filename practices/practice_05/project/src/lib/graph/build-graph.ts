import { GRAPH_LIMITS, type Limits } from '../limits'
import {
  analyzeZipFile,
  formatBytes,
  type AnalysisResult,
} from '../zip-analyzer'
import { parseCsFile } from './cs-parser'
import { parseCsproj } from './csproj-parser'
import {
  baseNameOf,
  buildTablePathMap,
  byteCompare,
  findNearestProject,
  pathKey,
  referenceTarget,
  resolveProjectReference,
  sortUnique,
} from './paths'
import { readGraphSources } from './zip-source'
import type {
  EdgeKind,
  ExternalPackageNode,
  GraphEdge,
  GraphLimits,
  GraphNode,
  GraphResult,
  GraphStats,
  GraphWarning,
  GraphWarningCode,
  ParsedCsFile,
  ParsedProjectFile,
  ProjectNode,
  SourceFileNode,
  UnresolvedItem,
  UnresolvedReason,
} from './types'

export class GraphAnalysisError extends Error {
  code:
    | 'NO_CSHARP_FILES'
    | 'LIMIT_TEXT_BYTES'
    | 'LIMIT_NODES'
    | 'LIMIT_EDGES'
    | 'INPUT_MISMATCH'
  limit?: number
  actual?: number
  limitName?: 'maxTextBytes' | 'maxNodes' | 'maxEdges'

  constructor(
    code: GraphAnalysisError['code'],
    message: string,
    details?: {
      limit?: number
      actual?: number
      limitName?: 'maxTextBytes' | 'maxNodes' | 'maxEdges'
    }
  ) {
    super(message)
    this.name = 'GraphAnalysisError'
    this.code = code
    this.limit = details?.limit
    this.actual = details?.actual
    this.limitName = details?.limitName
  }
}

const NODE_KIND_ORDER: Record<GraphNode['kind'], number> = {
  project: 0,
  source: 1,
  package: 2,
}

const EDGE_KIND_ORDER: Record<EdgeKind, number> = {
  'project-reference': 0,
  'package-reference': 1,
  using: 2,
}

const WARNING_ORDER: Record<GraphWarningCode, number> = {
  DUPLICATE_PATH: 0,
  EMPTY_NAMESPACE: 1,
  FILE_TOO_LARGE: 2,
  MULTIPLE_PROJECTS_IN_DIR: 3,
  PARSE_ISSUE: 4,
}

function escapeIdPart(value: string | null | undefined): string {
  return (value ?? '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|')
}

function edgeId(edge: Omit<GraphEdge, 'id'>): string {
  return [
    edge.from,
    edge.to,
    edge.kind,
    edge.namespace,
    edge.packageVersion,
    edge.condition,
  ]
    .map(escapeIdPart)
    .join('|')
}

function unresolvedId(
  kind: UnresolvedItem['kind'],
  fromId: string,
  target: string,
  reason: UnresolvedReason
): string {
  return [kind, fromId, target, reason].map(escapeIdPart).join('|')
}

function isSystemNamespace(target: string): boolean {
  return target === 'System' || target.startsWith('System.')
}

function nodeCompare(a: GraphNode, b: GraphNode): number {
  return (
    NODE_KIND_ORDER[a.kind] - NODE_KIND_ORDER[b.kind] ||
    byteCompare(a.id, b.id)
  )
}

function edgeCompare(a: GraphEdge, b: GraphEdge): number {
  return (
    byteCompare(a.from, b.from) ||
    byteCompare(a.to, b.to) ||
    EDGE_KIND_ORDER[a.kind] - EDGE_KIND_ORDER[b.kind] ||
    byteCompare(a.id, b.id)
  )
}

function unresolvedCompare(a: UnresolvedItem, b: UnresolvedItem): number {
  return (
    byteCompare(a.kind, b.kind) ||
    byteCompare(a.fromId, b.fromId) ||
    byteCompare(a.target, b.target) ||
    byteCompare(a.id, b.id)
  )
}

function warningCompare(a: GraphWarning, b: GraphWarning): number {
  return (
    WARNING_ORDER[a.code] - WARNING_ORDER[b.code] ||
    byteCompare(a.paths[0] ?? '', b.paths[0] ?? '') ||
    a.count - b.count
  )
}

function sortedVersions(versions: Iterable<string | null>): Array<string | null> {
  const unique = Array.from(new Set(versions))
  const nulls = unique.filter((v): v is null => v === null)
  const strings = unique.filter((v): v is string => v !== null).sort(byteCompare)
  return [...nulls, ...strings]
}

function sortCandidates(
  candidates: Iterable<string>,
  reason: UnresolvedReason
): string[] {
  const unique = Array.from(new Set(candidates))
  if (reason === 'STATIC_USING_UNSUPPORTED' || reason === 'ALIAS_TARGET_UNSUPPORTED') {
    unique.sort((a, b) => b.length - a.length || byteCompare(a, b))
  } else {
    unique.sort(byteCompare)
  }
  return unique
}

function prefixCandidates(
  target: string,
  namespaces: Iterable<string>
): string[] {
  const result: string[] = []
  for (const namespace of namespaces) {
    if (target === namespace || target.startsWith(`${namespace}.`)) {
      result.push(namespace)
    }
  }
  return result
}

function projectNameFromPath(path: string): string {
  const base = baseNameOf(path)
  return base.replace(/\.csproj$/i, '') || base
}

function warning(
  code: GraphWarningCode,
  message: string,
  paths: Iterable<string>,
  count: number
): GraphWarning {
  return { code, message, paths: sortUnique(paths), count }
}

/**
 * Строит статический граф зависимостей C#-проекта из уже проверенного ZIP.
 * Код не выполняется, содержимое кроме .cs/.csproj не читается.
 */
export async function analyzeCsharpGraph(
  file: File,
  analysis: AnalysisResult,
  limits?: Partial<GraphLimits>
): Promise<GraphResult> {
  const L: GraphLimits = { ...GRAPH_LIMITS, ...(limits || {}) }

  if (analysis.archiveName !== file.name) {
    throw new GraphAnalysisError(
      'INPUT_MISMATCH',
      'Результат анализа относится к другому архиву.'
    )
  }

  const read = await readGraphSources(file, analysis, L)
  if (read.sources.length === 0) {
    throw new GraphAnalysisError(
      'NO_CSHARP_FILES',
      'В архиве нет C#-файлов или файлов проекта для анализа.'
    )
  }
  if (read.textBytes > L.maxTextBytes) {
    throw new GraphAnalysisError(
      'LIMIT_TEXT_BYTES',
      `Текст C#-файлов превышает лимит ${formatBytes(L.maxTextBytes)}.`,
      {
        limit: L.maxTextBytes,
        actual: read.textBytes,
        limitName: 'maxTextBytes',
      }
    )
  }

  const tablePaths = buildTablePathMap(analysis.files)
  const duplicateKeys = new Set(read.duplicateGroups.map((group) => pathKey(group.path)))

  const sourceByPath = new Map<string, SourceFileNode>()
  const projectByPath = new Map<string, ProjectNode>()
  const csByPath = new Map<string, ParsedCsFile>()
  const parsedProjectByPath = new Map<string, ParsedProjectFile>()

  for (const source of read.sources) {
    const key = pathKey(source.path)
    const tablePath = duplicateKeys.has(key)
      ? null
      : tablePaths.get(key) ?? null

    if (source.ext === 'cs') {
      const parsed = source.text !== null ? parseCsFile(source.text) : null
      if (parsed) csByPath.set(key, parsed)
      const status =
        source.text === null
          ? 'unknown'
          : parsed && (parsed.issue || parsed.namespaces.length === 0)
            ? 'partial'
            : 'known'
      const node: SourceFileNode = {
        id: `file:${source.path}`,
        label: source.path,
        status,
        kind: 'source',
        path: source.path,
        tablePath,
        projectId: null,
        namespaces: parsed?.namespaces ?? [],
        usingCount: parsed?.usings.length ?? 0,
      }
      sourceByPath.set(key, node)
      continue
    }

    const parsed =
      source.text !== null ? parseCsproj(source.text, source.path) : null
    if (parsed) parsedProjectByPath.set(key, parsed)
    const status =
      source.text === null ? 'unknown' : parsed?.issue ? 'partial' : 'known'
    const node: ProjectNode = {
      id: `project:${source.path}`,
      label: parsed?.name ?? projectNameFromPath(source.path),
      status,
      kind: 'project',
      path: source.path,
      tablePath,
      name: parsed?.name ?? projectNameFromPath(source.path),
      targetFrameworks: parsed?.targetFrameworks ?? [],
      sourceFileIds: [],
    }
    projectByPath.set(key, node)
  }

  const projectPaths = Array.from(projectByPath.values())
    .map((project) => project.path)
    .sort(byteCompare)

  const multipleProjectDirs = new Map<string, string[]>()
  for (const source of sourceByPath.values()) {
    const nearest = findNearestProject(source.path, projectPaths)
    if (!nearest.projectPath) continue
    const project = projectByPath.get(pathKey(nearest.projectPath))
    if (!project) continue
    source.projectId = project.id
    project.sourceFileIds.push(source.id)
    if (nearest.candidates.length > 1) {
      const key = pathKey(nearest.directory ?? '')
      if (!multipleProjectDirs.has(key)) {
        multipleProjectDirs.set(key, [...nearest.candidates])
      }
    }
  }

  const sourceById = new Map<string, SourceFileNode>()
  for (const source of sourceByPath.values()) sourceById.set(source.id, source)

  for (const project of projectByPath.values()) {
    project.sourceFileIds = sortUnique(project.sourceFileIds)
    if (project.status === 'unknown') continue
    const parsed = parsedProjectByPath.get(pathKey(project.path))
    const hasIncompleteSource = project.sourceFileIds.some(
      (id) => sourceById.get(id)?.status !== 'known'
    )
    if (parsed?.issue || hasIncompleteSource) project.status = 'partial'
    else project.status = 'known'
  }

  const namespaceToSourceIds = new Map<string, string[]>()
  const lowerToNamespaces = new Map<string, Set<string>>()
  const allNamespaces = new Set<string>()
  for (const source of sourceById.values()) {
    for (const namespace of source.namespaces) {
      allNamespaces.add(namespace)
      const ids = namespaceToSourceIds.get(namespace)
      if (ids) ids.push(source.id)
      else namespaceToSourceIds.set(namespace, [source.id])
      const lower = namespace.toLowerCase()
      const exact = lowerToNamespaces.get(lower)
      if (exact) exact.add(namespace)
      else lowerToNamespaces.set(lower, new Set([namespace]))
    }
  }
  for (const ids of namespaceToSourceIds.values()) ids.sort(byteCompare)

  const edgeMap = new Map<string, GraphEdge>()
  const unresolvedMap = new Map<string, UnresolvedItem>()
  const systemUsingPairs = new Set<string>()
  const externalUsingPairs = new Set<string>()
  const packageByLower = new Map<string, ExternalPackageNode>()
  const packageVersions = new Map<string, Set<string | null>>()

  const addEdge = (input: Omit<GraphEdge, 'id'>) => {
    if (input.from === input.to) return
    const edge: GraphEdge = { ...input, id: edgeId(input) }
    if (!edgeMap.has(edge.id)) edgeMap.set(edge.id, edge)
  }

  const addUnresolved = (
    kind: UnresolvedItem['kind'],
    reason: UnresolvedReason,
    fromId: string,
    target: string,
    candidates: string[],
    message: string
  ) => {
    const id = unresolvedId(kind, fromId, target, reason)
    const existing = unresolvedMap.get(id)
    const sorted = sortCandidates(candidates, reason)
    if (existing) {
      existing.count++
      existing.candidates = sortCandidates(
        [...existing.candidates, ...sorted],
        reason
      )
      return
    }
    unresolvedMap.set(id, {
      id,
      kind,
      reason,
      fromId,
      target,
      candidates: sorted,
      count: 1,
      message,
    })
  }

  const usingMessage: Record<
    Exclude<UnresolvedReason, 'PROJECT_NOT_FOUND'>,
    string
  > = {
    EXTERNAL_NAMESPACE: 'Namespace не найден в архиве; связь не создана.',
    NAMESPACE_NOT_FOUND:
      'Namespace не найден, но есть объявленные namespace с похожим префиксом.',
    NAMESPACE_CASE_MISMATCH:
      'Namespace найден только в другом регистре; связь не создана.',
    STATIC_USING_UNSUPPORTED:
      'Статический using не поддерживается статическим анализом.',
    ALIAS_TARGET_UNSUPPORTED:
      'Цель alias не совпадает с объявленным namespace.',
  }

  for (const source of sourceById.values()) {
    const parsed = csByPath.get(pathKey(source.path))
    if (!parsed) continue

    for (const using of parsed.usings) {
      const target = using.target
      if (!target) continue

      if (isSystemNamespace(target)) {
        systemUsingPairs.add(`${source.id}\u0000${target}`)
        continue
      }

      const exact = namespaceToSourceIds.get(target)
      const declaresOwn = source.namespaces.includes(target)
      if (exact && declaresOwn) continue

      if (using.alias !== null) {
        if (exact) {
          for (const toId of exact) {
            addEdge({
              from: source.id,
              to: toId,
              kind: 'using',
              certainty: 'namespace-match',
              namespace: target,
              condition: null,
            })
          }
        } else {
          externalUsingPairs.add(`${source.id}\u0000${target}`)
          addUnresolved(
            'using',
            'ALIAS_TARGET_UNSUPPORTED',
            source.id,
            target,
            prefixCandidates(target, allNamespaces),
            usingMessage.ALIAS_TARGET_UNSUPPORTED
          )
        }
        continue
      }

      if (using.isStatic) {
        externalUsingPairs.add(`${source.id}\u0000${target}`)
        addUnresolved(
          'using',
          'STATIC_USING_UNSUPPORTED',
          source.id,
          target,
          prefixCandidates(target, allNamespaces),
          usingMessage.STATIC_USING_UNSUPPORTED
        )
        continue
      }

      if (exact) {
        for (const toId of exact) {
          addEdge({
            from: source.id,
            to: toId,
            kind: 'using',
            certainty: 'namespace-match',
            namespace: target,
            condition: null,
          })
        }
        continue
      }

      externalUsingPairs.add(`${source.id}\u0000${target}`)
      const caseCandidates = lowerToNamespaces.get(target.toLowerCase())
      if (caseCandidates && caseCandidates.size > 0) {
        addUnresolved(
          'using',
          'NAMESPACE_CASE_MISMATCH',
          source.id,
          target,
          Array.from(caseCandidates),
          usingMessage.NAMESPACE_CASE_MISMATCH
        )
        continue
      }

      const prefixes = prefixCandidates(target, allNamespaces)
      if (prefixes.length > 0) {
        addUnresolved(
          'using',
          'NAMESPACE_NOT_FOUND',
          source.id,
          target,
          prefixes,
          usingMessage.NAMESPACE_NOT_FOUND
        )
      } else {
        addUnresolved(
          'using',
          'EXTERNAL_NAMESPACE',
          source.id,
          target,
          [],
          usingMessage.EXTERNAL_NAMESPACE
        )
      }
    }
  }

  for (const project of projectByPath.values()) {
    const parsed = parsedProjectByPath.get(pathKey(project.path))
    if (!parsed) continue

    for (const ref of parsed.projectRefs) {
      const resolved = resolveProjectReference(project.path, ref.include)
      const targetProject = resolved
        ? projectByPath.get(pathKey(resolved))
        : undefined
      if (targetProject) {
        if (targetProject.id === project.id) continue
        addEdge({
          from: project.id,
          to: targetProject.id,
          kind: 'project-reference',
          certainty: ref.condition ? 'conditional' : 'declared',
          condition: ref.condition,
        })
        continue
      }

      const target = resolved ?? referenceTarget(ref.include)
      const includeBase = baseNameOf(referenceTarget(ref.include)).toLowerCase()
      const candidates = projectPaths.filter(
        (path) => baseNameOf(path).toLowerCase() === includeBase
      )
      addUnresolved(
        'project-reference',
        'PROJECT_NOT_FOUND',
        project.id,
        target,
        candidates,
        'Проект по ссылке не найден в архиве.'
      )
    }

    for (const ref of parsed.packageRefs) {
      const id = ref.id.trim()
      if (!id) continue
      const lower = id.toLowerCase()
      let packageNode = packageByLower.get(lower)
      if (!packageNode) {
        packageNode = {
          id: `package:${lower}`,
          label: lower,
          status: 'known',
          kind: 'package',
          packageId: id,
          versions: [],
        }
        packageByLower.set(lower, packageNode)
        packageVersions.set(lower, new Set())
      }
      packageVersions.get(lower)!.add(ref.version)
      addEdge({
        from: project.id,
        to: packageNode.id,
        kind: 'package-reference',
        certainty: ref.condition ? 'conditional' : 'declared',
        packageVersion: ref.version,
        condition: ref.condition,
      })
    }
  }

  for (const [lower, packageNode] of packageByLower) {
    packageNode.versions = sortedVersions(packageVersions.get(lower) ?? [])
  }

  const nodes: GraphNode[] = [
    ...projectByPath.values(),
    ...sourceById.values(),
    ...packageByLower.values(),
  ].sort(nodeCompare)
  const edges = Array.from(edgeMap.values()).sort(edgeCompare)
  const unresolved = Array.from(unresolvedMap.values()).sort(unresolvedCompare)

  if (nodes.length > L.maxNodes) {
    throw new GraphAnalysisError(
      'LIMIT_NODES',
      `Граф содержит ${nodes.length} узлов — больше лимита ${L.maxNodes}.`,
      { limit: L.maxNodes, actual: nodes.length, limitName: 'maxNodes' }
    )
  }
  if (edges.length > L.maxEdges) {
    throw new GraphAnalysisError(
      'LIMIT_EDGES',
      `Граф содержит ${edges.length} связей — больше лимита ${L.maxEdges}.`,
      { limit: L.maxEdges, actual: edges.length, limitName: 'maxEdges' }
    )
  }

  const warnings: GraphWarning[] = []
  if (read.fileTooLargePaths.length > 0) {
    warnings.push(
      warning(
        'FILE_TOO_LARGE',
        `Файлы больше ${formatBytes(L.maxFileBytes)} не прочитаны и показаны как «неизвестные».`,
        read.fileTooLargePaths,
        read.fileTooLargePaths.length
      )
    )
  }
  if (read.duplicateGroups.length > 0) {
    warnings.push(
      warning(
        'DUPLICATE_PATH',
        'Записи с одинаковыми путями объединены в один неизвестный узел.',
        read.duplicateGroups.map((group) => group.path),
        read.duplicateGroups.reduce((sum, group) => sum + group.count, 0)
      )
    )
  }
  if (multipleProjectDirs.size > 0) {
    const affected = new Set<string>()
    let count = 0
    for (const candidates of multipleProjectDirs.values()) {
      count += candidates.length
      for (const candidate of candidates) affected.add(candidate)
    }
    warnings.push(
      warning(
        'MULTIPLE_PROJECTS_IN_DIR',
        'В одном каталоге несколько проектов; исходные файлы отнесены к первому по порядку.',
        affected,
        count
      )
    )
  }

  const emptyNamespacePaths: string[] = []
  for (const source of sourceById.values()) {
    const parsed = csByPath.get(pathKey(source.path))
    if (parsed && parsed.namespaces.length === 0) {
      emptyNamespacePaths.push(source.path)
    }
  }
  if (emptyNamespacePaths.length > 0) {
    warnings.push(
      warning(
        'EMPTY_NAMESPACE',
        'В файлах без namespace связи могут быть неполными.',
        emptyNamespacePaths,
        emptyNamespacePaths.length
      )
    )
  }

  const parseIssuePaths = new Set<string>(read.readIssuePaths)
  for (const [key, parsed] of csByPath) {
    if (parsed.issue) parseIssuePaths.add(sourceByPath.get(key)?.path ?? key)
  }
  for (const [key, parsed] of parsedProjectByPath) {
    if (parsed.issue) parseIssuePaths.add(projectByPath.get(key)?.path ?? key)
  }
  if (parseIssuePaths.size > 0) {
    warnings.push(
      warning(
        'PARSE_ISSUE',
        'Часть файлов не удалось полностью разобрать; связи могут быть неполными.',
        parseIssuePaths,
        parseIssuePaths.size
      )
    )
  }
  warnings.sort(warningCompare)

  const stats: GraphStats = {
    projectCount: nodes.filter((node) => node.kind === 'project').length,
    sourceFileCount: nodes.filter((node) => node.kind === 'source').length,
    packageCount: nodes.filter((node) => node.kind === 'package').length,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    namespaceCount: allNamespaces.size,
    systemUsingCount: systemUsingPairs.size,
    externalUsingCount: externalUsingPairs.size,
    unresolvedCount: unresolved.reduce((sum, item) => sum + item.count, 0),
    excluded: read.excluded,
  }

  return {
    archiveName: analysis.archiveName,
    nodes,
    edges,
    unresolved,
    stats,
    warnings,
  }
}

/**
 * Необязательная обёртка для тестов: анализ ZIP и графа одним вызовом.
 * UI использует двухшаговый вызов, чтобы ошибка графа не скрывала таблицу.
 */
export async function analyzeProjectZip(
  file: File,
  limits?: Partial<Limits & GraphLimits>
): Promise<{ analysis: AnalysisResult; graph: GraphResult }> {
  const analysis = await analyzeZipFile(file, limits)
  const graphLimits: Partial<GraphLimits> = {}
  if (limits?.maxFileBytes !== undefined) graphLimits.maxFileBytes = limits.maxFileBytes
  if (limits?.maxTextBytes !== undefined) graphLimits.maxTextBytes = limits.maxTextBytes
  if (limits?.maxNodes !== undefined) graphLimits.maxNodes = limits.maxNodes
  if (limits?.maxEdges !== undefined) graphLimits.maxEdges = limits.maxEdges
  const graph = await analyzeCsharpGraph(file, analysis, graphLimits)
  return { analysis, graph }
}
