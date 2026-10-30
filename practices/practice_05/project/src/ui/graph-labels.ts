import type {
  EdgeCertainty,
  EdgeKind,
  GraphNode,
  NodeStatus,
  UnresolvedReason,
} from '../lib/graph'

export const NODE_KIND_LABEL: Record<GraphNode['kind'], string> = {
  project: 'проект',
  source: 'файл',
  package: 'пакет',
}

export const STATUS_LABEL: Record<NodeStatus, string> = {
  known: 'известен',
  partial: 'частично',
  unknown: 'неизвестен',
}

export const EDGE_KIND_LABEL: Record<EdgeKind, string> = {
  'project-reference': 'ссылка на проект',
  'package-reference': 'ссылка на пакет',
  using: 'using',
}

export const CERTAINTY_LABEL: Record<EdgeCertainty, string> = {
  declared: 'объявленная',
  'namespace-match': 'совпадение namespace',
  conditional: 'условная',
}

export const REASON_LABEL: Record<UnresolvedReason, string> = {
  EXTERNAL_NAMESPACE: 'внешний namespace',
  NAMESPACE_NOT_FOUND: 'namespace не найден',
  NAMESPACE_CASE_MISMATCH: 'namespace в другом регистре',
  STATIC_USING_UNSUPPORTED: 'using static не поддерживается',
  ALIAS_TARGET_UNSUPPORTED: 'цель alias не найдена',
  PROJECT_NOT_FOUND: 'проект не найден',
}

export function versionText(version: string | null | undefined): string {
  return version === null || version === undefined || version === ''
    ? 'не указана'
    : version
}
