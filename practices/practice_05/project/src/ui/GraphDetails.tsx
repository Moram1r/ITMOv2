import React from 'react'
import type {
  GraphEdge,
  GraphNode,
  GraphResult,
  GraphSelection,
  UnresolvedItem,
} from '../lib/graph'
import {
  CERTAINTY_LABEL,
  EDGE_KIND_LABEL,
  NODE_KIND_LABEL,
  REASON_LABEL,
  STATUS_LABEL,
  versionText,
} from './graph-labels'

export type GraphDetailsProps = {
  result: GraphResult
  selection: GraphSelection
  onSelect: (selection: GraphSelection) => void
  onShowInTable: (tablePath: string) => void
}

function labelOf(result: GraphResult, id: string): string {
  return result.nodes.find((node) => node.id === id)?.label ?? id
}

function nodeOf(result: GraphResult, id: string): GraphNode | undefined {
  return result.nodes.find((node) => node.id === id)
}

function edgeOf(result: GraphResult, id: string): GraphEdge | undefined {
  return result.edges.find((edge) => edge.id === id)
}

function unresolvedOf(
  result: GraphResult,
  id: string
): UnresolvedItem | undefined {
  return result.unresolved.find((item) => item.id === id)
}

function NodeLink({
  result,
  id,
  onSelect,
}: {
  result: GraphResult
  id: string
  onSelect: (selection: GraphSelection) => void
}) {
  return (
    <button
      type="button"
      className="graph-details__link"
      onClick={() => onSelect({ kind: 'node', id })}
    >
      {labelOf(result, id)}
    </button>
  )
}

function NodeDetails({
  result,
  node,
  onSelect,
  onShowInTable,
}: {
  result: GraphResult
  node: GraphNode
  onSelect: (selection: GraphSelection) => void
  onShowInTable: (tablePath: string) => void
}) {
  const incoming = result.edges.filter((edge) => edge.to === node.id)
  const outgoing = result.edges.filter((edge) => edge.from === node.id)
  const unresolvedOut = result.unresolved.filter(
    (item) => item.fromId === node.id
  )
  const project = node.kind === 'source' && node.projectId
    ? nodeOf(result, node.projectId)
    : undefined

  return (
    <div className="graph-details__body">
      <div className="graph-details__head">
        <span className="graph-details__kind">
          {NODE_KIND_LABEL[node.kind]}
        </span>
        <span className={`graph-details__status is-${node.status}`}>
          {STATUS_LABEL[node.status]}
        </span>
      </div>
      <h3>{node.label}</h3>

      <dl className="graph-details__facts">
        {node.kind !== 'package' && (
          <>
            <dt>Путь</dt>
            <dd><code>{node.path}</code></dd>
          </>
        )}
        {node.kind === 'package' && (
          <>
            <dt>Package ID</dt>
            <dd><code>{node.packageId}</code></dd>
            <dt>Версии</dt>
            <dd>
              {node.versions.length === 0
                ? 'не указаны'
                : node.versions.map((version) => versionText(version)).join(', ')}
            </dd>
          </>
        )}
        {node.kind === 'project' && (
          <>
            <dt>Target frameworks</dt>
            <dd>
              {node.targetFrameworks.length === 0
                ? 'не указаны'
                : node.targetFrameworks.join(', ')}
            </dd>
            <dt>Исходные файлы</dt>
            <dd>{node.sourceFileIds.length}</dd>
          </>
        )}
        {node.kind === 'source' && (
          <>
            <dt>Проект</dt>
            <dd>
              {project ? (
                <NodeLink result={result} id={project.id} onSelect={onSelect} />
              ) : (
                'не найден'
              )}
            </dd>
            <dt>Namespace</dt>
            <dd>
              {node.namespaces.length === 0
                ? 'не объявлен'
                : node.namespaces.join(', ')}
            </dd>
            <dt>Using</dt>
            <dd>{node.usingCount}</dd>
          </>
        )}
        <dt>Входящие</dt>
        <dd>{incoming.length}</dd>
        <dt>Исходящие</dt>
        <dd>{outgoing.length}</dd>
        <dt>Неразрешённые исходящие</dt>
        <dd>{unresolvedOut.length}</dd>
      </dl>

      {node.kind === 'project' && node.sourceFileIds.length > 0 && (
        <section className="graph-details__section">
          <h4>Исходные файлы</h4>
          <ul className="graph-details__links">
            {node.sourceFileIds.map((id) => (
              <li key={id}>
                <NodeLink result={result} id={id} onSelect={onSelect} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="graph-details__section">
        <h4>Входящие связи ({incoming.length})</h4>
        {incoming.length === 0 ? (
          <p className="graph-hint">Входящих связей нет.</p>
        ) : (
          <ul className="graph-details__links">
            {incoming.map((edge) => (
              <li key={edge.id}>
                <NodeLink result={result} id={edge.from} onSelect={onSelect} />
                <span className="graph-details__muted">
                  {' '}
                  · {EDGE_KIND_LABEL[edge.kind]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="graph-details__section">
        <h4>Исходящие связи ({outgoing.length})</h4>
        {outgoing.length === 0 ? (
          <p className="graph-hint">Исходящих связей нет.</p>
        ) : (
          <ul className="graph-details__links">
            {outgoing.map((edge) => (
              <li key={edge.id}>
                <NodeLink result={result} id={edge.to} onSelect={onSelect} />
                <span className="graph-details__muted">
                  {' '}
                  · {EDGE_KIND_LABEL[edge.kind]}
                  {edge.certainty === 'conditional' ? ' · условная' : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {unresolvedOut.length > 0 && (
        <section className="graph-details__section">
          <h4>Неразрешённые исходящие ({unresolvedOut.length})</h4>
          <ul className="graph-details__links">
            {unresolvedOut.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="graph-details__link"
                  onClick={() =>
                    onSelect({ kind: 'unresolved', id: item.id })
                  }
                >
                  {item.target}
                </button>
                <span className="graph-details__muted">
                  {' '}
                  · {REASON_LABEL[item.reason]}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="graph-details__actions">
        {node.kind === 'package' ? (
          <p className="graph-hint">
            У пакета нет файла в таблице. Переход доступен для проектов и
            исходных файлов.
          </p>
        ) : node.tablePath !== null ? (
          <button
            type="button"
            onClick={() => onShowInTable(node.tablePath!)}
          >
            Показать в таблице файлов
          </button>
        ) : (
          <p className="graph-hint">
            Переход в таблицу недоступен: исходный путь не найден или путь
            встречается в архиве несколько раз.
          </p>
        )}
      </div>
    </div>
  )
}

function EdgeDetails({
  result,
  edge,
  onSelect,
}: {
  result: GraphResult
  edge: GraphEdge
  onSelect: (selection: GraphSelection) => void
}) {
  return (
    <div className="graph-details__body">
      <div className="graph-details__head">
        <span className="graph-details__kind">связь</span>
        <span
          className={`graph-details__status${
            edge.certainty === 'conditional' ? ' is-partial' : ''
          }`}
        >
          {CERTAINTY_LABEL[edge.certainty]}
        </span>
      </div>
      <h3>
        <NodeLink result={result} id={edge.from} onSelect={onSelect} />
        <span className="graph-details__arrow"> → </span>
        <NodeLink result={result} id={edge.to} onSelect={onSelect} />
      </h3>

      <dl className="graph-details__facts">
        <dt>Тип</dt>
        <dd>{EDGE_KIND_LABEL[edge.kind]}</dd>
        <dt>Достоверность</dt>
        <dd>{CERTAINTY_LABEL[edge.certainty]}</dd>
        {edge.namespace && (
          <>
            <dt>Namespace</dt>
            <dd><code>{edge.namespace}</code></dd>
          </>
        )}
        {edge.packageVersion !== undefined && (
          <>
            <dt>Версия пакета</dt>
            <dd>{versionText(edge.packageVersion)}</dd>
          </>
        )}
        {edge.condition !== null && edge.condition !== undefined && (
          <>
            <dt>Условие</dt>
            <dd><code>{edge.condition}</code></dd>
          </>
        )}
      </dl>

      {edge.certainty === 'conditional' && (
        <p className="graph-hint">
          Связь объявлена в файле проекта под условием MSBuild. Значение условия
          показано выше и не вычисляется.
        </p>
      )}
    </div>
  )
}

function UnresolvedDetails({
  result,
  item,
  onSelect,
}: {
  result: GraphResult
  item: UnresolvedItem
  onSelect: (selection: GraphSelection) => void
}) {
  return (
    <div className="graph-details__body">
      <div className="graph-details__head">
        <span className="graph-details__kind">неразрешённая ссылка</span>
        <span className="graph-details__status is-unknown">не ребро</span>
      </div>
      <h3>{item.target}</h3>

      <dl className="graph-details__facts">
        <dt>Тип ссылки</dt>
        <dd>{item.kind === 'using' ? 'using' : 'ссылка на проект'}</dd>
        <dt>Причина</dt>
        <dd>{REASON_LABEL[item.reason]}</dd>
        <dt>Повторов</dt>
        <dd>{item.count}</dd>
        <dt>Исходный узел</dt>
        <dd>
          <NodeLink result={result} id={item.fromId} onSelect={onSelect} />
        </dd>
        <dt>Кандидаты</dt>
        <dd>
          {item.candidates.length === 0
            ? 'не найдены'
            : item.candidates.join(', ')}
        </dd>
      </dl>

      <p className="graph-details__message">{item.message}</p>
      <p className="graph-hint">
        Неразрешённые ссылки не создают рёбер и фиктивных узлов. Они показаны
        отдельно, чтобы граф оставался честным.
      </p>
    </div>
  )
}

export function GraphDetails({
  result,
  selection,
  onSelect,
  onShowInTable,
}: GraphDetailsProps) {
  let content: React.ReactNode

  if (!selection) {
    content = (
      <p className="graph-hint">
        Выберите узел, связь или неразрешённую ссылку, чтобы увидеть детали.
      </p>
    )
  } else if (selection.kind === 'node') {
    const node = nodeOf(result, selection.id)
    content = node ? (
      <NodeDetails
        result={result}
        node={node}
        onSelect={onSelect}
        onShowInTable={onShowInTable}
      />
    ) : (
      <p className="graph-hint">Узел не найден.</p>
    )
  } else if (selection.kind === 'edge') {
    const edge = edgeOf(result, selection.id)
    content = edge ? (
      <EdgeDetails result={result} edge={edge} onSelect={onSelect} />
    ) : (
      <p className="graph-hint">Связь не найдена.</p>
    )
  } else {
    const item = unresolvedOf(result, selection.id)
    content = item ? (
      <UnresolvedDetails result={result} item={item} onSelect={onSelect} />
    ) : (
      <p className="graph-hint">Неразрешённая ссылка не найдена.</p>
    )
  }

  return (
    <aside
      className="graph-details"
      aria-label="Детали выбранного элемента"
      aria-live="polite"
    >
      {content}
    </aside>
  )
}
