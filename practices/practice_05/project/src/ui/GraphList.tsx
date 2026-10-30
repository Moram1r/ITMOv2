import React from 'react'
import type { GraphResult, GraphSelection } from '../lib/graph'
import {
  CERTAINTY_LABEL,
  EDGE_KIND_LABEL,
  NODE_KIND_LABEL,
  REASON_LABEL,
  STATUS_LABEL,
  versionText,
} from './graph-labels'

export type GraphListProps = {
  result: GraphResult
  selection: GraphSelection
  showUnresolvedOnly: boolean
  onSelect: (selection: GraphSelection) => void
  onShowInTable: (tablePath: string) => void
}

function labelOf(result: GraphResult, id: string): string {
  return result.nodes.find((node) => node.id === id)?.label ?? id
}

export function GraphList({
  result,
  selection,
  showUnresolvedOnly,
  onSelect,
  onShowInTable,
}: GraphListProps) {
  const unresolved = result.unresolved
  const excluded = result.stats.excluded

  const unresolvedSection = (
    <section className="graph-list__section" aria-labelledby="graph-list-unresolved">
      <h3 id="graph-list-unresolved">
        Неразрешённые ссылки ({unresolved.length})
      </h3>
      {unresolved.length === 0 ? (
        <p className="graph-hint">Неразрешённых ссылок нет.</p>
      ) : (
        <ul className="graph-list__items">
          {unresolved.map((item) => {
            const selected =
              selection?.kind === 'unresolved' && selection.id === item.id
            return (
              <li key={item.id} className="graph-list__row">
                <button
                  type="button"
                  className={`graph-list__item${selected ? ' is-selected' : ''}`}
                  aria-pressed={selected}
                  onClick={() => onSelect({ kind: 'unresolved', id: item.id })}
                >
                  <span className="graph-list__badge graph-list__badge--unresolved">
                    ссылка
                  </span>
                  <span className="graph-list__label">{item.target}</span>
                  <span className="graph-list__meta">
                    {REASON_LABEL[item.reason]}, повторов: {item.count}
                  </span>
                  <span className="graph-list__meta">
                    от {labelOf(result, item.fromId)}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )

  return (
    <div className="graph-list">
      <p className="graph-list__excluded">
        Исключено: obj/bin — {excluded.objBin}, прочие —{' '}
        {excluded.otherTypes}, всего — {excluded.total}.
      </p>

      {showUnresolvedOnly ? (
        <>
          <p className="graph-list__filter-note">
            Показаны только неразрешённые ссылки. Снимите флажок, чтобы вернуть
            полный список.
          </p>
          {unresolvedSection}
        </>
      ) : (
        <>
          <section className="graph-list__section" aria-labelledby="graph-list-nodes">
            <h3 id="graph-list-nodes">Узлы ({result.nodes.length})</h3>
            <ul className="graph-list__items">
              {result.nodes.map((node) => {
                const selected =
                  selection?.kind === 'node' && selection.id === node.id
                return (
                  <li key={node.id} className="graph-list__row">
                    <button
                      type="button"
                      className={`graph-list__item${selected ? ' is-selected' : ''}`}
                      aria-pressed={selected}
                      onClick={() => onSelect({ kind: 'node', id: node.id })}
                    >
                      <span
                        className={`graph-list__badge graph-list__badge--${node.kind}`}
                      >
                        {NODE_KIND_LABEL[node.kind]}
                      </span>
                      <span className="graph-list__label">{node.label}</span>
                      <span
                        className={`graph-list__status graph-list__status--${node.status}`}
                      >
                        {STATUS_LABEL[node.status]}
                      </span>
                    </button>
                    {node.kind !== 'package' && node.tablePath !== null && (
                      <button
                        type="button"
                        className="graph-list__table"
                        onClick={() => onShowInTable(node.tablePath!)}
                      >
                        В таблице
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>

          <section className="graph-list__section" aria-labelledby="graph-list-edges">
            <h3 id="graph-list-edges">Связи ({result.edges.length})</h3>
            {result.edges.length === 0 ? (
              <p className="graph-hint">Связей не найдено.</p>
            ) : (
              <ul className="graph-list__items">
                {result.edges.map((edge) => {
                  const selected =
                    selection?.kind === 'edge' && selection.id === edge.id
                  return (
                    <li key={edge.id} className="graph-list__row">
                      <button
                        type="button"
                        className={`graph-list__item${selected ? ' is-selected' : ''}`}
                        aria-pressed={selected}
                        onClick={() => onSelect({ kind: 'edge', id: edge.id })}
                      >
                        <span
                          className={`graph-list__badge graph-list__badge--edge`}
                        >
                          {EDGE_KIND_LABEL[edge.kind]}
                        </span>
                        <span className="graph-list__label">
                          {labelOf(result, edge.from)} →{' '}
                          {labelOf(result, edge.to)}
                        </span>
                        <span
                          className={`graph-list__certainty${
                            edge.certainty === 'conditional'
                              ? ' is-conditional'
                              : ''
                          }`}
                        >
                          {CERTAINTY_LABEL[edge.certainty]}
                        </span>
                        {edge.namespace && (
                          <span className="graph-list__meta">
                            namespace: {edge.namespace}
                          </span>
                        )}
                        {edge.packageVersion !== undefined && (
                          <span className="graph-list__meta">
                            версия: {versionText(edge.packageVersion)}
                          </span>
                        )}
                        {edge.condition !== null &&
                          edge.condition !== undefined && (
                            <span className="graph-list__meta">
                              условие: <code>{edge.condition}</code>
                            </span>
                          )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          {unresolvedSection}
        </>
      )}
    </div>
  )
}
