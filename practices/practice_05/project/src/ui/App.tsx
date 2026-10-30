import React, { Suspense, useEffect, useRef, useState } from 'react'
import { analyzeZipFile, formatBytes, ZipAnalysisError } from '../lib/zip-analyzer'

const GraphTab = React.lazy(() => import('./GraphTab'))

type Tab = 'files' | 'graph'

type State =
  | { kind: 'idle' }
  | { kind: 'selected'; file: File }
  | { kind: 'processing'; file: File }
  | { kind: 'error'; message: string }
  | {
      kind: 'done'
      file: File
      result: Awaited<ReturnType<typeof analyzeZipFile>>
    }

export function App() {
  const [state, setState] = useState<State>({ kind: 'idle' })
  const [tab, setTab] = useState<Tab>('files')
  const [graphMounted, setGraphMounted] = useState(false)
  const [tablePath, setTablePath] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const resetSecondaryState = () => {
    setTab('files')
    setGraphMounted(false)
    setTablePath(null)
  }

  const onSelect: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const f = e.target.files?.[0] || null
    // Reset results and error on new selection
    resetSecondaryState()
    if (!f) {
      setState({ kind: 'idle' })
      return
    }
    setState({ kind: 'selected', file: f })
  }

  const onAnalyze = async () => {
    if (state.kind !== 'selected') return
    const file = state.file
    resetSecondaryState()
    setState({ kind: 'processing', file })
    try {
      const result = await analyzeZipFile(file)
      setState({ kind: 'done', file, result })
    } catch (err) {
      const msg = err instanceof ZipAnalysisError ? err.message : 'Не удалось обработать архив.'
      setState({ kind: 'error', message: msg })
    }
  }

  const resetFile = () => {
    // Clear input and state to choose another file
    if (inputRef.current) inputRef.current.value = ''
    resetSecondaryState()
    setState({ kind: 'idle' })
  }

  const activateTab = (next: Tab) => {
    if (next === 'graph') setGraphMounted(true)
    setTab(next)
  }

  const onTabKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const next: Tab = tab === 'files' ? 'graph' : 'files'
    activateTab(next)
    document.getElementById(`tab-${next}`)?.focus()
  }

  const showInTable = (path: string) => {
    setTablePath(path)
    setTab('files')
  }

  useEffect(() => {
    if (tab !== 'files' || tablePath === null) return
    const row = document.querySelector<HTMLElement>('tr[data-highlighted="true"]')
    if (!row) return
    row.scrollIntoView({ block: 'center' })
    row.focus({ preventScroll: true })
  }, [tab, tablePath])

  const disabledAnalyze = state.kind !== 'selected'
  const isBusy = state.kind === 'processing'

  return (
    <div className="app" role="application" aria-label="Рентген проекта">
      <h1 className="title">Рентген проекта</h1>
      <div className="panel" aria-live="polite">
        <div className="controls">
          <div>
            <label htmlFor="zip-input">Загрузить ZIP</label>
            <input
              id="zip-input"
              ref={inputRef}
              type="file"
              accept=".zip,application/zip"
              onChange={onSelect}
            />
          </div>
          <div>
            <button onClick={onAnalyze} disabled={disabledAnalyze || isBusy} aria-disabled={disabledAnalyze || isBusy}>
              {isBusy ? 'Идёт обработка…' : 'Проанализировать'}
            </button>
          </div>
        </div>

        {state.kind === 'idle' && (
          <p className="footer">Выберите локальный ZIP-архив и нажмите «Проанализировать».</p>
        )}

        {state.kind === 'selected' && (
          <div className="summary" style={{ marginTop: 12 }}>
            <div><span className="k">Выбран файл:</span> <span className="v">{state.file.name}</span></div>
            <div><span className="k">Размер файла:</span> <span className="v">{formatBytes(state.file.size)}</span></div>
          </div>
        )}

        {state.kind === 'processing' && (
          <p className="loading">Обработка архива…</p>
        )}

        {state.kind === 'error' && (
          <div className="error" role="alert">
            <div style={{ marginBottom: 8 }}>{state.message}</div>
            <button onClick={resetFile}>Выбрать другой архив</button>
          </div>
        )}

        {state.kind === 'done' && (
          <div>
            <div className="summary">
              <div><span className="k">Архив:</span> <span className="v">{state.result.archiveName}</span></div>
              <div><span className="k">Файлов:</span> <span className="v">{state.result.fileCount}</span></div>
              <div><span className="k">Суммарный несжатый размер:</span> <span className="v">{formatBytes(state.result.totalUncompressedBytes)}</span></div>
            </div>

            <div
              className="tabs"
              role="tablist"
              aria-label="Разделы результата"
              onKeyDown={onTabKeyDown}
            >
              <button
                type="button"
                role="tab"
                id="tab-files"
                aria-selected={tab === 'files'}
                aria-controls="panel-files"
                tabIndex={tab === 'files' ? 0 : -1}
                className={`tab${tab === 'files' ? ' is-active' : ''}`}
                onClick={() => activateTab('files')}
              >
                Файлы
              </button>
              <button
                type="button"
                role="tab"
                id="tab-graph"
                aria-selected={tab === 'graph'}
                aria-controls="panel-graph"
                tabIndex={tab === 'graph' ? 0 : -1}
                className={`tab${tab === 'graph' ? ' is-active' : ''}`}
                onClick={() => activateTab('graph')}
              >
                Граф
              </button>
            </div>

            <div
              id="panel-files"
              role="tabpanel"
              aria-labelledby="tab-files"
              hidden={tab !== 'files'}
            >
              <div className="tablewrap" role="region" aria-label="Таблица файлов">
                <table>
                  <thead>
                    <tr>
                      <th>Путь</th>
                      <th>Расширение</th>
                      <th>Несжатый размер</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.result.files.map((f) => {
                      const highlighted = f.path === tablePath
                      return (
                        <tr
                          key={f.path}
                          className={highlighted ? 'is-highlighted' : undefined}
                          data-highlighted={highlighted ? 'true' : undefined}
                          tabIndex={highlighted ? -1 : undefined}
                        >
                          <td className="path" title={f.path}>{f.path}</td>
                          <td className="ext">{f.ext ?? '—'}</td>
                          <td className="size">{formatBytes(f.sizeUncompressed)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {graphMounted && (
              <div
                id="panel-graph"
                role="tabpanel"
                aria-labelledby="tab-graph"
                hidden={tab !== 'graph'}
              >
                <Suspense
                  fallback={
                    <p className="loading" role="status">
                      Загружаем панель графа…
                    </p>
                  }
                >
                  <GraphTab
                    file={state.file}
                    analysis={state.result}
                    active={tab === 'graph'}
                    onShowInTable={showInTable}
                  />
                </Suspense>
              </div>
            )}

            <div className="row" style={{ marginTop: 12 }}>
              <button onClick={resetFile}>Выбрать другой архив</button>
            </div>
          </div>
        )}
      </div>

      <p className="footer">Размеры и лимиты: ZIP ≤ 20 МиБ, записей ≤ 2000, суммарный несжатый размер ≤ 100 МиБ.</p>
    </div>
  )
}
