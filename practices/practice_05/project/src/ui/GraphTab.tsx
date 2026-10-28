import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { AnalysisResult } from '../lib/zip-analyzer'
import {
  analyzeCsharpGraph,
  GraphAnalysisError,
  GRAPH_DISPLAY_LIMITS,
} from '../lib/graph'
import type {
  GraphResult,
  GraphSelection,
  GraphStatus,
} from '../lib/graph'
import { graphDisplayMode, reduceGraph } from '../lib/graph/layout'
import { GraphDetails } from './GraphDetails'
import { GraphList } from './GraphList'
import { GraphView } from './GraphView'

export type GraphTabProps = {
  file: File
  analysis: AnalysisResult
  active: boolean
  onShowInTable: (tablePath: string) => void
}

type ViewMode = 'list' | 'graph'

function limitText(error: GraphAnalysisError): string {
  const limit = error.limit ?? 0
  const actual = error.actual ?? 0
  return `Лимит: ${limit.toLocaleString('ru-RU')}, фактически: ${actual.toLocaleString('ru-RU')}.`
}

function GraphTab({
  file,
  analysis,
  active,
  onShowInTable,
}: GraphTabProps) {
  const [status, setStatus] = useState<GraphStatus>('notStarted')
  const [result, setResult] = useState<GraphResult | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [selection, setSelection] = useState<GraphSelection>(null)
  const [showUnresolvedOnly, setShowUnresolvedOnly] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('graph')

  const tokenRef = useRef(0)
  const startedRef = useRef(false)

  const reset = useCallback(() => {
    tokenRef.current++
    startedRef.current = false
    setStatus('notStarted')
    setResult(null)
    setError(null)
    setSelection(null)
    setShowUnresolvedOnly(false)
    setViewMode('graph')
  }, [])

  useEffect(() => {
    reset()
  }, [file, reset])

  const startBuild = useCallback(async () => {
    const token = ++tokenRef.current
    setStatus('building')
    setError(null)
    setResult(null)
    setSelection(null)
    setShowUnresolvedOnly(false)

    try {
      const graph = await analyzeCsharpGraph(file, analysis)
      if (token !== tokenRef.current) return
      if (graph.nodes.length === 0) {
        setStatus('empty')
        return
      }
      setResult(graph)
      setViewMode(
        graphDisplayMode(graph.nodes, graph.edges) === 'full' ? 'graph' : 'list'
      )
      setStatus('done')
    } catch (caught) {
      if (token !== tokenRef.current) return
      if (caught instanceof GraphAnalysisError) {
        if (caught.code === 'NO_CSHARP_FILES') {
          setStatus('empty')
          setError(null)
          return
        }
        if (
          caught.code === 'LIMIT_TEXT_BYTES' ||
          caught.code === 'LIMIT_NODES' ||
          caught.code === 'LIMIT_EDGES'
        ) {
          setStatus('limit')
          setError(caught)
          return
        }
      }
      setStatus('error')
      setError(
        caught instanceof Error
          ? caught
          : new Error('Не удалось построить граф зависимостей.')
      )
    }
  }, [analysis, file])

  useEffect(() => {
    if (!active || status !== 'notStarted' || startedRef.current) return
    startedRef.current = true
    void startBuild()
  }, [active, startBuild, status])

  const retry = () => {
    startedRef.current = true
    void startBuild()
  }

  const mode = useMemo(
    () =>
      result
        ? graphDisplayMode(result.nodes, result.edges)
        : 'full',
    [result]
  )

  const reduced = useMemo(
    () =>
      result && mode === 'reduced'
        ? reduceGraph(result.nodes, result.edges)
        : null,
    [mode, result]
  )

  if (status === 'notStarted') {
    return <div className="graph-panel" />
  }

  if (status === 'building') {
    return (
      <div className="graph-panel">
        <p className="loading" role="status">
          Строим граф зависимостей…
        </p>
        <p className="graph-hint">
          Читаются только файлы <code>.cs</code> и <code>.csproj</code>. Таблица
          файлов остаётся доступной на вкладке «Файлы».
        </p>
      </div>
    )
  }

  if (status === 'empty') {
    return (
      <div className="graph-panel">
        <div className="graph-empty">
          <h2>Граф не построен</h2>
          <p>
            В архиве нет файлов <code>.cs</code> или <code>.csproj</code> вне
            каталогов <code>obj/</code> и <code>bin/</code>.
          </p>
          <p className="graph-hint">
            Таблица файлов и сводка остаются доступными. Повтор не нужен:
            анализировать нечего.
          </p>
        </div>
      </div>
    )
  }

  if (status === 'limit') {
    const graphError = error instanceof GraphAnalysisError ? error : null
    return (
      <div className="graph-panel">
        <div className="graph-empty graph-empty--limit" role="alert">
          <h2>Превышен лимит анализа</h2>
          <p>{graphError?.message ?? 'Граф превысил допустимый размер.'}</p>
          {graphError?.limit !== undefined && (
            <p className="graph-hint">{limitText(graphError)}</p>
          )}
          <p className="graph-hint">
            Таблица файлов и сводка остаются доступными. Повтор не поможет:
            лимит жёсткий.
          </p>
        </div>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="graph-panel">
        <div className="graph-empty graph-empty--error" role="alert">
          <h2>Не удалось построить граф зависимостей</h2>
          <p>{error?.message ?? 'Неизвестная ошибка.'}</p>
          <button onClick={retry}>Повторить</button>
          <p className="graph-hint">
            Таблица файлов и сводка не затронуты. Можно вернуться на вкладку
            «Файлы».
          </p>
        </div>
      </div>
    )
  }

  if (!result) {
    return (
      <div className="graph-panel">
        <p className="graph-hint">Нет данных графа.</p>
      </div>
    )
  }

  const graphAvailable = mode !== 'listOnly'
  const effectiveView: ViewMode =
    viewMode === 'graph' && graphAvailable ? 'graph' : 'list'
  const reducedNodes = reduced?.nodes.length ?? result.nodes.length
  const reducedEdges = reduced?.edges.length ?? result.edges.length

  return (
    <div className="graph-panel">
      <div className="graph-heading">
        <div>
          <h2>Зависимости проекта</h2>
          <p className="graph-hint">
            Стрелка показывает направление «зависит от». Пунктир и подпись
            «условная» означают условие в файле проекта.
          </p>
        </div>
        <p className="graph-live" role="status" aria-live="polite">
          {effectiveView === 'graph'
            ? `Показан граф: ${reducedNodes} из ${result.nodes.length} узлов, ${reducedEdges} из ${result.edges.length} связей.`
            : `Показан полный список: ${result.nodes.length} узлов, ${result.edges.length} связей.`}
        </p>
      </div>

      <dl className="graph-stats" aria-label="Счётчики графа">
        <div><dt>Проекты</dt><dd>{result.stats.projectCount}</dd></div>
        <div><dt>Файлы</dt><dd>{result.stats.sourceFileCount}</dd></div>
        <div><dt>Пакеты</dt><dd>{result.stats.packageCount}</dd></div>
        <div><dt>Связи</dt><dd>{result.stats.edgeCount}</dd></div>
        <div><dt>Namespace</dt><dd>{result.stats.namespaceCount}</dd></div>
        <div><dt>System using</dt><dd>{result.stats.systemUsingCount}</dd></div>
        <div><dt>Внешние using</dt><dd>{result.stats.externalUsingCount}</dd></div>
        <div className={result.stats.unresolvedCount > 0 ? 'graph-stat--warn' : undefined}>
          <dt>Неразрешённые ссылки</dt>
          <dd>{result.stats.unresolvedCount}</dd>
        </div>
        <div><dt>Исключено obj/bin</dt><dd>{result.stats.excluded.objBin}</dd></div>
        <div><dt>Исключено прочих</dt><dd>{result.stats.excluded.otherTypes}</dd></div>
        <div><dt>Исключено всего</dt><dd>{result.stats.excluded.total}</dd></div>
      </dl>

      {(result.warnings.length > 0 || result.stats.unresolvedCount > 0) && (
        <div className="graph-warnings" role="status">
          <h3>Граф неполный — это честно показано</h3>
          {result.warnings.length > 0 && (
            <ul>
              {result.warnings.map((item) => (
                <li key={item.code}>
                  {item.message} Затронуто файлов: {item.count}.
                </li>
              ))}
            </ul>
          )}
          {result.stats.unresolvedCount > 0 && (
            <p>
              Неразрешённых ссылок: {result.stats.unresolvedCount}. Они не
              нарисованы на графе и доступны отдельным списком.
            </p>
          )}
        </div>
      )}

      <div className="graph-toolbar">
        <div className="graph-view-toggle" role="group" aria-label="Режим отображения">
          <button
            type="button"
            className={effectiveView === 'list' ? 'is-active' : undefined}
            aria-pressed={effectiveView === 'list'}
            onClick={() => setViewMode('list')}
          >
            Список
          </button>
          <button
            type="button"
            className={effectiveView === 'graph' ? 'is-active' : undefined}
            aria-pressed={effectiveView === 'graph'}
            disabled={!graphAvailable}
            onClick={() => setViewMode('graph')}
          >
            Граф
          </button>
        </div>
        <label className="graph-filter">
          <input
            type="checkbox"
            checked={showUnresolvedOnly}
            onChange={(event) => setShowUnresolvedOnly(event.target.checked)}
          />
          Показать неразрешённые
        </label>
      </div>

      {mode === 'reduced' && effectiveView === 'graph' && (
        <p className="graph-notice">
          Граф большой, поэтому показана упрощённая часть: {reducedNodes} из{' '}
          {result.nodes.length} узлов и {reducedEdges} из {result.edges.length}{' '}
          связей. Полный список доступен на переключателе «Список».
        </p>
      )}

      {mode === 'listOnly' && (
        <p className="graph-notice">
          Граф больше {GRAPH_DISPLAY_LIMITS.maxInteractiveNodes} узлов или{' '}
          {GRAPH_DISPLAY_LIMITS.maxInteractiveEdges} связей. Интерактивный граф
          отключён, показан полный список.
        </p>
      )}

      <div className="graph-layout">
        <div className="graph-main">
          {effectiveView === 'graph' && graphAvailable ? (
            <GraphView
              result={result}
              selection={selection}
              mode={mode === 'reduced' ? 'reduced' : 'full'}
              onSelect={setSelection}
              onShowInTable={onShowInTable}
            />
          ) : (
            <GraphList
              result={result}
              selection={selection}
              showUnresolvedOnly={showUnresolvedOnly}
              onSelect={setSelection}
              onShowInTable={onShowInTable}
            />
          )}
        </div>
        <GraphDetails
          result={result}
          selection={selection}
          onSelect={setSelection}
          onShowInTable={onShowInTable}
        />
      </div>
    </div>
  )
}

export default GraphTab
