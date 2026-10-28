# Contract: модуль графа и UI-вкладка

**Фича**: `001-csharp-dependency-graph` | **Дата**: 2026-10-28
**Источник истины**: [contract.md](./contract.md); здесь — интерфейс реализации.

## 1. Публичный API `src/lib/graph/index.ts`

```ts
export const GRAPH_LIMITS: GraphLimits
export const GRAPH_DISPLAY_LIMITS: GraphDisplayLimits

export function analyzeCsharpGraph(
  file: File,
  analysis: AnalysisResult,
  limits?: Partial<GraphLimits>
): Promise<GraphResult>

export function analyzeProjectZip(
  file: File,
  limits?: Partial<Limits & GraphLimits>
): Promise<{ analysis: AnalysisResult; graph: GraphResult }>

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
}
```

Типы `GraphResult`, `GraphNode`, `GraphEdge`, `UnresolvedItem`,
`UnresolvedReason`, `GraphStats`, `GraphWarning`, `GraphWarningCode`,
`GraphLimits`, `GraphDisplayLimits` экспортируются из `src/lib/graph/types.ts`
и реэкспортируются из `index.ts`.

### Гарантии

- `analyzeZipFile` и `AnalysisResult` не меняются; `GraphResult.archiveName` совпадает с `AnalysisResult.archiveName`.
- `analyzeCsharpGraph` не изменяет `file` и `analysis`, не обращается к DOM,
  не использует сеть, не выполняет загруженный код.
- `analysis.archiveName !== file.name` → `INPUT_MISMATCH`.
- Отсутствие `.cs`/`.csproj` → `NO_CSHARP_FILES`.
- Ошибка отдельного файла не роняет граф: `status: 'unknown'` + `GraphWarning`.
- Namespace сравнивается с учётом регистра; пути — без учёта регистра.
- Повторные `using` не создают дубликатов рёбер; у неразрешённых ссылок повторы агрегируются в `count`; рёбра `from === to` и `using` на собственный namespace не создаются и в `unresolved` не попадают.
- `using static` попадает в `unresolved` (`STATIC_USING_UNSUPPORTED`), alias без точного namespace — в `ALIAS_TARGET_UNSUPPORTED`; исключение — `System`/`System.*`, они не дают ни рёбер, ни `unresolved`.
- Дубликаты нормализованных путей дают один узел `unknown`, `tablePath: null` и предупреждение `DUPLICATE_PATH`.
- `tablePath` — исходная строка из `AnalysisResult.files`, у которой нормализованный путь совпадает с `path`; если подходящих строк несколько или нет — `null`.
- В `GraphResult` нет исходного текста файлов, литералов и HTML.
- Одинаковый ZIP и лимиты → структурно одинаковый `GraphResult`.
- `analyzeProjectZip` — обёртка для тестов; UI её не использует.

### Лимиты

```ts
GRAPH_LIMITS = {
  maxFileBytes: 1 * 1024 * 1024,
  maxTextBytes: 20 * 1024 * 1024,
  maxNodes: 3000,
  maxEdges: 10000,
}

GRAPH_DISPLAY_LIMITS = {
  comfortableNodes: 200,
  comfortableEdges: 500,
  maxInteractiveNodes: 1000,
  maxInteractiveEdges: 3000,
}
```

### Ошибки

| Код | Когда | Поля | Повтор в UI |
| --- | --- | --- | --- |
| `NO_CSHARP_FILES` | нет пригодных для чтения `.cs`/`.csproj` вне `obj/`/`bin/` (включая небезопасные пути) | — | нет, пустое состояние |
| `LIMIT_TEXT_BYTES` | суммарный текст > 20 МиБ | `limit`, `actual`, `limitName` | нет |
| `LIMIT_NODES` | узлов > 3000 | `limit`, `actual`, `limitName` | нет |
| `LIMIT_EDGES` | рёбер > 10 000 | `limit`, `actual`, `limitName` | нет |
| `INPUT_MISMATCH` | `AnalysisResult` от другого файла | — | да |

`message` — готовая русская строка без фрагментов кода.

## 2. UI-контракт

```ts
type GraphTabProps = {
  file: File
  analysis: AnalysisResult
  active: boolean
  onShowInTable: (tablePath: string) => void
}

type GraphViewProps = {
  result: GraphResult
  selection: GraphSelection
  mode: 'full' | 'reduced'
  onSelect: (selection: GraphSelection) => void
  onShowInTable: (tablePath: string) => void
}

type GraphListProps = {
  result: GraphResult
  selection: GraphSelection
  showUnresolvedOnly: boolean
  onSelect: (selection: GraphSelection) => void
  onShowInTable: (tablePath: string) => void
}

type GraphDetailsProps = {
  result: GraphResult
  selection: GraphSelection
  onSelect: (selection: GraphSelection) => void
  onShowInTable: (tablePath: string) => void
}
```

### Поведение

- `GraphTab` не строит граф, пока `active !== true`; повторный `active` не
  перезапускает анализ.
- После первого открытия `GraphTab` остаётся смонтированным; переключение
  вкладок скрывает панель, но сохраняет результат, выбор и масштаб.
- При новом `file` компонент сбрасывается; устаревший ответ игнорируется.
- `GraphTab` рендерит одно из состояний `GraphStatus`; таблица и сводка
  остаются в `App` и не размонтируются.
- Внутри `GraphTab` есть переключатель «Список»/«Граф»; при превышении
  хотя бы одного комфортного порога по умолчанию активен «Список», выше
  максимума «Граф» недоступен.
- `onShowInTable` вызывается только при `tablePath !== null`; `App` переключает
  вкладку «Файлы» и подсвечивает строку.
- `GraphView` получает только готовые `nodes`/`edges`; layout выполняется
  в `layout.ts`, не в компоненте.
- Список доступен всегда, когда есть `GraphResult`; при `large` он открыт первым.
- В упрощённом режиме граф показывает не более 200 узлов с наибольшей суммарной
  степенью (`входящие + исходящие`; при равенстве — по `id`) и не более 500
  связей, оба конца которых попали в эти узлы, с наибольшей суммой степеней
  концов (при равенстве — по `id` ребра); подписи «показано X из Y» есть
  для узлов и рёбер.
- Все элементы управления доступны с клавиатуры, имеют видимый фокус и
  текстовые `aria`-описания.

### События и состояние

| Событие | Результат |
| --- | --- |
| Первое открытие вкладки | `notStarted → building` |
| Успешный ответ | `building → done` |
| `NO_CSHARP_FILES` | `building → empty` |
| `LIMIT_*` | `building → limit` |
| Прочая ошибка | `building → error` |
| «Повторить» | `error → building` |
| Новый архив | сброс в `notStarted` |
| Выбор узла/ребра/ссылки | обновление `GraphSelection` |
| «Показать в таблице» | `onShowInTable(tablePath)` |
| Сброс | очистка выбора, фильтра и масштаба |

## 3. Что не входит в контракт

- серверные вызовы, сохранение результатов, URL-состояние;
- отмена построения и прогресс в процентах;
- редактирование графа, экспорт, поиск, кластеризация;
- анализ `.sln`, `.props`, `.targets`, `Directory.Packages.props`;
- семантический анализ C# и разрешение типов.
