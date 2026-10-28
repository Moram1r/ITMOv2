# Контракт фичи «Граф зависимостей C#-проекта»

**Статус:** согласован с UI- и logic-командами; решения раздела 11 подтверждены 2026-10-28.  
**Основа:** `spec-ui-before.md`, `spec-logic-before.md`.  
**Дата:** 2026-10-28.  
**Правило:** контракт — источник истины; изменения согласуются человеком.

## 1. Границы фичи

Фича добавляет в существующее приложение вкладку «Граф»:

- анализируются только `.cs` и `.csproj` внутри ZIP;
- C#-код не выполняется, не компилируется и не импортируется;
- `obj/`, `bin/`, `.sln`, секретоподобные файлы и остальные типы не анализируются;
- граф дополняет таблицу файлов, а не заменяет её;
- существующие `analyzeZipFile`, таблица, сводка, лимиты ZIP и ошибки сохраняются.

## 2. Схема работы

```text
analyzeZipFile(file) ──► AnalysisResult ──► сводка и таблица
                                               │
                                               ▼
                                  пользователь открывает «Граф»
                                               │
                                               ▼
                         analyzeCsharpGraph(file, analysis)
                                               │
                         ┌─────────────────────┴─────────────────────┐
                         ▼                                           ▼
                    GraphResult                              GraphAnalysisError
                         │                                           │
                         ▼                                           ▼
                 граф / список / детали                     ошибка или лимит
```

### 2.1. Жизненный цикл

1. После успешного `analyzeZipFile` появляются вкладки «Файлы» и «Граф». По умолчанию активна «Файлы».
2. Граф **не строится автоматически**. Он запускается при первом открытии вкладки «Граф».
3. Пока граф строится, таблица и сводка остаются доступными.
4. Повторное открытие вкладки не перезапускает анализ; результат сохраняется в рамках текущего архива. После первого открытия панель графа остаётся смонтированной, переключение вкладок её только скрывает.
5. Кнопка «Повторить» доступна только для ошибки графа. Для `NO_CSHARP_FILES` и жёстких лимитов повтора нет.
6. Отмены в MVP нет. При выборе нового архива старый результат игнорируется по токену запроса.
7. Ошибка графа не очищает `AnalysisResult`, таблицу и сводку.
8. «Выбрать другой архив» сбрасывает анализ, граф, выбранный узел, фильтр и масштаб.

## 3. Публичный API

```ts
// Существующий API не меняется.
analyzeZipFile(file: File, limits?: Partial<Limits>): Promise<AnalysisResult>

// Основной API графа. Переоткрывает ZIP и читает только .cs/.csproj.
analyzeCsharpGraph(
  file: File,
  analysis: AnalysisResult,
  limits?: Partial<GraphLimits>
): Promise<GraphResult>

// Необязательная обёртка для тестов; UI её не использует.
analyzeProjectZip(
  file: File,
  limits?: Partial<Limits & GraphLimits>
): Promise<{ analysis: AnalysisResult; graph: GraphResult }>

export const GRAPH_LIMITS: GraphLimits
export const GRAPH_DISPLAY_LIMITS: GraphDisplayLimits
```

Требования:

- `analyzeCsharpGraph` не меняет `file` и `analysis`;
- UI использует двухшаговый вызов, чтобы ошибка графа не уничтожала таблицу;
- `analyzeProjectZip` при ошибке графа не возвращает таблицу, поэтому в UI не применяется;
- `analyzeZipFile` и `AnalysisResult` остаются без изменений;
- `INPUT_MISMATCH` — внутренняя защита от передачи `AnalysisResult` от другого файла, не пользовательская ошибка.

## 4. Модель данных

### 4.1. Узлы

```ts
type NodeStatus = 'known' | 'partial' | 'unknown'

type GraphNodeBase = {
  id: string
  label: string
  status: NodeStatus
}

type ProjectNode = GraphNodeBase & {
  kind: 'project'
  path: string                 // нормализованный путь для идентичности
  tablePath: string | null     // исходная строка из AnalysisResult.files
  name: string
  targetFrameworks: string[]
  sourceFileIds: string[]
}

type SourceFileNode = GraphNodeBase & {
  kind: 'source'
  path: string
  tablePath: string | null
  projectId: string | null
  namespaces: string[]
  usingCount: number
}

type ExternalPackageNode = GraphNodeBase & {
  kind: 'package'
  packageId: string
  versions: Array<string | null>
}

type GraphNode = ProjectNode | SourceFileNode | ExternalPackageNode
```

`tablePath` — исходная строка пути из `AnalysisResult.files`, у которой нормализованный путь совпадает с `path`; UI ищет строку таблицы по этой строке. Для пакета `tablePath` отсутствует. Если подходящих строк несколько или нет, `tablePath: null`, и UI не показывает переход к таблице.

Принадлежность `.cs` проекту: ближайший `.csproj` вверх по каталогам. Если в каталоге несколько `.csproj`, выбирается первый по побайтовому порядку нормализованного пути, а в `warnings` добавляется `MULTIPLE_PROJECTS_IN_DIR`.

`label`: проект — `name`; исходный файл — `path`; пакет — `packageId` (в нижнем регистре).

Если две записи ZIP дают один нормализованный путь (сравнение без учёта регистра), создаётся один узел; его `id` строится по первой по байтовому порядку записи, `tablePath: null`, текст не читается, `status: 'unknown'`. Путь добавляется в `paths` предупреждения `DUPLICATE_PATH`, а `count` учитывает все записи с дубликатами.

`status`:

- `source`: `known` — прочитан и разобран; `partial` — прочитан с замечанием разбора или пустым namespace; `unknown` — не прочитан (больше 1 МиБ или ошибка чтения).
- `project`: `known` — `.csproj` прочитан и все исходники `known`; `partial` — есть `partial`/`unknown` исходник или замечание разбора; `unknown` — `.csproj` не прочитан.
- `package`: всегда `known`.

`usingCount` — число using-директив в файле, включая `System` и повторы; `sourceFileIds` — только существующие `SourceFileNode.id`. Массивы `namespaces`, `targetFrameworks` и `sourceFileIds` уникальны и отсортированы побайтово; `versions` — `null` первым, затем строки побайтово.

### 4.2. Рёбра

```ts
type EdgeKind = 'project-reference' | 'package-reference' | 'using'
type EdgeCertainty = 'declared' | 'namespace-match' | 'conditional'

type GraphEdge = {
  id: string
  from: string
  to: string
  kind: EdgeKind
  certainty: EdgeCertainty
  namespace?: string
  packageVersion?: string | null
  condition?: string | null
}
```

Направление: **`from` — зависимый, `to` — зависимость**. Стрелка показывает «зависит от». Для не-условных рёбер `condition: null`; для ссылок без версии `packageVersion: null`; `namespace` отсутствует только у не-using рёбер. Это делает `id` детерминированным.

- `declared` — явный `ProjectReference` или `PackageReference`;
- `namespace-match` — `using` сопоставлен с файлами, объявившими namespace;
- `conditional` — ссылка в `.csproj` находится под условием MSBuild (`Condition`, `Choose/When`).

### 4.3. Неразрешённые ссылки

```ts
type UnresolvedReason =
  | 'EXTERNAL_NAMESPACE'
  | 'NAMESPACE_NOT_FOUND'
  | 'NAMESPACE_CASE_MISMATCH'
  | 'STATIC_USING_UNSUPPORTED'
  | 'ALIAS_TARGET_UNSUPPORTED'
  | 'PROJECT_NOT_FOUND'

type UnresolvedItem = {
  id: string
  kind: 'using' | 'project-reference'
  reason: UnresolvedReason
  fromId: string
  target: string
  candidates: string[]
  count: number
  message: string              // по-русски, без фрагментов кода
}
```

`UnresolvedItem` — **не ребро**. Неразрешённые ссылки не рисуются на графе и не создают фиктивных узлов. UI показывает их отдельным списком, счётчиком и фильтром «Показать неразрешённые».

`fromId` всегда указывает на существующий узел: ссылка возникает только из прочитанного `.cs` или `.csproj`.

`target` — namespace для `using` или нормализованный путь для `project-reference`. `candidates` — отсортированные уникальные варианты, которые удалось найти. Одинаковые ссылки агрегируются по `<kind>|<fromId>|<target>|<reason>`; `count` — число вхождений, включая повторные `using`.

### 4.4. Результат

```ts
type GraphWarningCode =
  | 'FILE_TOO_LARGE'
  | 'DUPLICATE_PATH'
  | 'MULTIPLE_PROJECTS_IN_DIR'
  | 'EMPTY_NAMESPACE'
  | 'PARSE_ISSUE'

type GraphWarning = {
  code: GraphWarningCode
  message: string
  paths: string[]
  count: number
}
```

`warnings` содержит не более одной записи на код; `paths` — все затронутые нормализованные пути, уникальные и отсортированные побайтово. `count`:

- `FILE_TOO_LARGE` — число файлов;
- `DUPLICATE_PATH` — суммарное число записей в группах дубликатов;
- `MULTIPLE_PROJECTS_IN_DIR` — суммарное число проектов в затронутых каталогах;
- `EMPTY_NAMESPACE` — число файлов без namespace;
- `PARSE_ISSUE` — число файлов с замечанием разбора.

```ts
type GraphStats = {
  projectCount: number
  sourceFileCount: number
  packageCount: number
  nodeCount: number
  edgeCount: number
  namespaceCount: number
  systemUsingCount: number
  externalUsingCount: number
  unresolvedCount: number      // сумма count по unresolved
  excluded: {
    objBin: number             // файлы под obj/ или bin/
    otherTypes: number         // остальные не-.cs/.csproj
    total: number
  }
}

type GraphResult = {
  archiveName: string
  nodes: GraphNode[]
  edges: GraphEdge[]
  unresolved: UnresolvedItem[]
  stats: GraphStats
  warnings: GraphWarning[]
}
```

`stats.unresolvedCount` — сумма `count`, а не длина массива `unresolved`: одна агрегированная запись может представлять несколько ссылок. `archiveName` совпадает с `AnalysisResult.archiveName`.

Остальные счётчики:

- `projectCount`, `sourceFileCount`, `packageCount` — число узлов соответствующего `kind`;
- `namespaceCount` — число уникальных объявленных namespace (с учётом регистра);
- `systemUsingCount` — число уникальных пар `(fromId, target)` для `using` на `System`/`System.*`, включая `using static` и alias;
- `externalUsingCount` — число уникальных пар `(fromId, target)` для `using` без точного namespace, кроме `System`/`System.*`, включая `using static` и alias;
- `unresolvedCount` — сумма `count` по всем `UnresolvedItem`.

`stats.excluded` считается по файлам из `AnalysisResult.files`:

- `objBin` — все файлы, у которых есть сегмент `obj` или `bin` на любом уровне (без учёта регистра);
- `otherTypes` — остальные файлы, которые не были прочитаны как `.cs`/`.csproj`: другие расширения и `.cs`/`.csproj` с небезопасным путём;
- `total` — сумма.

Дубликаты путей не входят в `excluded`: они отражены предупреждением `DUPLICATE_PATH`. `total` всегда равен `objBin + otherTypes`.

### 4.5. Идентификаторы и порядок

- проект: `project:<нормализованный путь>`;
- файл: `file:<нормализованный путь>`;
- пакет: `package:<lower-case id>`;
- ребро: `from|to|kind|namespace|packageVersion|condition`; отсутствующие значения сериализуются пустой строкой, `\` и `|` в значениях экранируются (`\\`, `\|`);
- неразрешённая ссылка: `<kind>|<fromId>|<target>|<reason>`; `\` и `|` в значениях экранируются.

Нормализация пути: `\` → `/`, повторные `/` и сегменты `.` сворачиваются, `..` — внутри корня; абсолютные пути, диск и выход за корень отбрасываются. Сравнение путей — без учёта регистра, отображение — в исходном регистре.

Порядок детерминирован:

- узлы — по `kind` (`project`, `source`, `package`), затем по `id`;
- рёбра — по `from`, `to`, `kind`, затем по `id`;
- `unresolved` — по `kind`, `fromId`, `target`, затем по `id`;
- `warnings` — по `code`, затем по первому пути и `count`.

Сортировка не зависит от локали. Одинаковый ZIP и лимиты дают структурно одинаковый `GraphResult`.

## 5. Семантика графа

### 5.1. Типы связей

- `project-reference`: проект → проект;
- `package-reference`: проект → пакет;
- `using`: файл → файл, объявивший используемый namespace.

`using` не создаёт рёбер к системным namespace (`System`, `System.*`) и к внешним namespace без файла в архиве. Внешние namespace попадают в `unresolved` с причиной `EXTERNAL_NAMESPACE`.

Сопоставление namespace — точное, **с учётом регистра**; пути нормализуются без учёта регистра. Совпадение только в другом регистре не создаёт ребро: это `NAMESPACE_CASE_MISMATCH` в `unresolved` с кандидатами. Несколько файлов могут объявлять один и тот же namespace — это не ошибка, рёбра идут к каждому другому файлу; если namespace объявлен в самом файле-источнике, ссылка не создаёт рёбер (см. ниже).

`using static` не создаёт рёбер: добавляется `STATIC_USING_UNSUPPORTED` (кроме `System`/`System.*`), а в `candidates` попадают объявленные namespace, являющиеся префиксом цели, от длинного к короткому. Alias даёт ребро только при точном совпадении цели с объявленным namespace, иначе `ALIAS_TARGET_UNSUPPORTED` с такими же кандидатами (кроме `System`/`System.*`).

Исключение для `System`/`System.*` действует и для `using static`, и для alias: ребро и `unresolved` не создаются, ссылка учитывается только в `stats.systemUsingCount`.

Повторные `using` не создают дубликатов рёбер (дедупликация по `(from, to, kind, namespace, packageVersion, condition)`); отдельного `count` у ребра нет. У неразрешённых ссылок повторы агрегируются, `count` — число вхождений. Если целевой namespace объявлен в самом файле, ссылка не создаёт рёбер ни к одному файлу и не попадает в `unresolved`. Правило `from === to` действует для всех типов рёбер: self-edge не создаётся и в `unresolved` не попадает.

`ProjectReference Include` разрешается относительно каталога `.csproj` и нормализуется. Если путь абсолютный, содержит диск или выходит за корень архива, ребро не создаётся, а ссылка попадает в `unresolved` с `PROJECT_NOT_FOUND`. MSBuild-свойства в `Include` (например, `$(SolutionDir)`) не раскрываются: такая ссылка также попадает в `unresolved` с `PROJECT_NOT_FOUND`.

### 5.2. Условные связи

Рёбра `.csproj` с `certainty: 'conditional'` отображаются пунктиром и подписью «условная». В деталях показывается условие; вложенные условия объединяются через ` && ` от внешнего к внутреннему. Они не считаются неразрешёнными. XML-комментарии в `.csproj` игнорируются и не создают ссылок. `#if` в `.cs` не вычисляется и не делает ребро условным; using внутри всех ветвей считаются присутствующими.

### 5.3. Циклы

Циклы разрешены и отображаются обычными рёбрами. В MVP нет отдельной подсветки циклов и топологической сортировки. UI не должен предполагать, что граф является DAG.

### 5.4. Версии пакетов

Один пакет — один узел `ExternalPackageNode` с массивом `versions`. Версии не разрешаются и не сравниваются; `null` идёт первым, затем строки побайтово. MSBuild-свойства в версии (например, `$(Version)`) сохраняются как текст и не раскрываются. Ребро хранит `packageVersion`; в деталях пакета показываются все встреченные версии.

### 5.5. Степени узла

UI вычисляет степени один раз из массивов:

- входящие — `edges.filter(e => e.to === node.id)`;
- исходящие — `edges.filter(e => e.from === node.id)`;
- неразрешённые исходящие — `unresolved.filter(u => u.fromId === node.id)`.

Отдельные поля степеней в `GraphResult` не добавляются.

### 5.6. Предупреждения

`warnings[].message` и `UnresolvedItem.message` — готовые русские строки. UI показывает их как есть и не разбирает `code` для текста. Коды нужны для тестов и диагностики.

## 6. Лимиты

### 6.1. Существующие лимиты ZIP

Не меняются:

| Лимит | Значение |
| --- | ---: |
| Размер ZIP | 20 МиБ |
| Записей ZIP, включая каталоги | 2000 |
| Суммарный несжатый объём | 100 МиБ |

### 6.2. Лимиты графа

```ts
type GraphLimits = {
  maxFileBytes: number    // 1 МиБ, мягкий
  maxTextBytes: number    // 20 МиБ, жёсткий
  maxNodes: number        // 3000, жёсткий
  maxEdges: number        // 10 000, жёсткий
}
```

- `maxFileBytes`: файл не читается, узел получает `status: 'unknown'`, добавляется предупреждение, граф продолжается.
- `maxTextBytes`: суммарный размер декодированного текста `.cs` + `.csproj` в UTF-8 байтах; превышение — `GraphAnalysisError('LIMIT_TEXT_BYTES')`, граф не возвращается.
- `maxNodes` / `maxEdges`: превышение — соответствующая ошибка, частичный граф не маскирует превышение.

Граф содержит только прямые ссылки; глубина анализа — 1. Рекурсивного обхода зависимостей нет, поэтому отдельный лимит глубины не нужен: объём ограничен `maxNodes` и `maxEdges`.

### 6.3. Ошибка графа

```ts
class GraphAnalysisError extends Error {
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

UI использует `limit`, `actual` и `limitName` для сообщения; `message` уже содержит понятный русский текст. `limitName` принимает одно из трёх значений и отсутствует у `NO_CSHARP_FILES` и `INPUT_MISMATCH`.

### 6.4. Пороги отображения

Это не лимиты анализа, а пороги UI:

```ts
type GraphDisplayLimits = {
  comfortableNodes: number      // 200
  comfortableEdges: number      // 500
  maxInteractiveNodes: number   // 1000
  maxInteractiveEdges: number   // 3000
}
```

- до комфортного порога — обычный интерактивный граф, по умолчанию открыт «Граф»;
- выше хотя бы одного комфортного порога — по умолчанию открыт полный список; переключатель «Граф» показывает упрощённый граф: не более 200 узлов с наибольшей суммарной степенью (`входящие + исходящие`; при равенстве — по `id`) и не более 500 связей, оба конца которых попали в эти узлы, с наибольшей суммой степеней концов (при равенстве — по `id` ребра), с отдельными подписями «показано X из Y» для узлов и рёбер;
- выше максимального — только полный список, счётчики и пояснение; переключатель «Граф» недоступен;
- список остаётся полным в пределах лимитов анализа;
- при упрощении показывается «показано X из Y», без кластеризации и скрытого усечения.

Внутри вкладки есть переключатель «Список»/«Граф». В обычном режиме активен «Граф», при превышении хотя бы одного комфортного порога — «Список», выше максимума «Граф» недоступен. Выбор переключателя не сбрасывает `GraphResult` и `GraphSelection`.

## 7. Состояния UI

```ts
type GraphStatus =
  | 'notStarted'
  | 'building'
  | 'done'
  | 'empty'
  | 'error'
  | 'limit'

type GraphSelection =
  | { kind: 'node'; id: string }
  | { kind: 'edge'; id: string }
  | { kind: 'unresolved'; id: string }
  | null
```

| Состояние | Когда | Что видно |
| --- | --- | --- |
| `notStarted` | Вкладка «Граф» ещё не открывалась | Таблица, вкладки; граф не строится |
| `building` | Идёт `analyzeCsharpGraph` | Индикатор без процентов; таблица доступна |
| `done` | Есть `GraphResult` | Переключатель «Список»/«Граф», счётчики, детали |
| `empty` | `NO_CSHARP_FILES` или `nodes.length === 0` | Объяснение, таблица доступна |
| `error` | Прочая ошибка графа | Сообщение, «Повторить», таблица доступна |
| `limit` | `LIMIT_TEXT_BYTES`, `LIMIT_NODES`, `LIMIT_EDGES` | Лимит и факт, таблица доступна |

`partial` — не состояние вкладки: это `done` при `unresolvedCount > 0` или непустых `warnings`. Показывается баннер, но граф остаётся рабочим. Узел при этом может иметь `status: 'partial'`; это поле `GraphNode`, а не `GraphStatus`.

`large` — не статус, а режим отображения по порогам из раздела 6.4.

### 7.1. Детали

- Узел: тип, `label`, статус, входящие/исходящие/неразрешённые, списки соседей. Для проекта и файла — `path` и `tablePath`; для пакета — `packageId` и `versions`, путь не показывается.
- Ребро: `from`, `to`, `kind`, `certainty`, `namespace`, `packageVersion`, `condition`.
- Неразрешённая ссылка: `kind`, `target`, `reason`, `candidates`, `count`, `message`, исходный узел.
- «Показать в таблице файлов» доступно только при `tablePath !== null`; для пакета и отсутствующего пути показывается пояснение.

### 7.2. Неразрешённые ссылки

- Счётчик — `stats.unresolvedCount`.
- Список — `GraphResult.unresolved`.
- Фильтр «Показать неразрешённые» фильтрует только список, не граф.
- На графе неразрешённые ссылки не рисуются.
- Тексты UI используют термин «неразрешённые ссылки», а не «неизвестные связи».

## 8. Ошибки и совместимость

- `ZipAnalysisError` пробрасывается без изменения кодов и текстов.
- `NO_CSHARP_FILES` — нет пригодных для чтения `.cs`/`.csproj` вне `obj/`/`bin/` (включая небезопасные пути); доменная ошибка, но UI показывает её как пустое состояние, не как красную ошибку.
- Ошибка отдельного `.cs`/`.csproj` не роняет граф: узел `unknown` + предупреждение.
- Ошибка графа не очищает таблицу и сводку.
- Неизвестная ошибка UI показывается как «Не удалось построить граф зависимостей» с возможностью повтора.
- В `GraphResult` нет исходного текста, строковых литералов, содержимого секретов и HTML.
- UI экранирует все пути, имена и сообщения при выводе.

## 9. Что обязано сохраниться

- `analyzeZipFile`, `AnalysisResult`, `ZipEntryInfo`, `ZipAnalysisError`, `LIMITS`, `formatBytes`.
- Сводка: архив, число файлов, суммарный несжатый размер.
- Таблица: путь, расширение, размер; сортировка по пути.
- Лимиты 20 МиБ / 2000 / 100 МиБ и существующие тексты ошибок.
- Сценарий пользователя, который не открывает «Граф», не меняется.
- «Выбрать другой архив» очищает input, результаты, граф, состояние выбора, фильтр и масштаб.
- Анализ остаётся в браузере: без сети, логирования, сохранения и передачи данных.

## 10. Проверяемые условия интеграции

1. **Старый сценарий.** ZIP в пределах лимитов: после анализа видны прежние сводка и таблица; вкладки появляются после готовности файлов; «Файлы» активна по умолчанию; сброс очищает всё.
2. **Основной граф.** ZIP с `A/A.csproj` → `B/B.csproj`, `PackageReference` и `using B.Services` даёт ожидаемые узлы и рёбра; namespace сравнивается с учётом регистра; направление `from` → `to` — «зависит от»; счётчики совпадают с массивами.
3. **Неразрешённые ссылки.** Для неизвестного namespace, namespace в другом регистре, `using static`/alias и несуществующего `ProjectReference` нет фиктивных рёбер; есть `unresolved`, `stats.unresolvedCount` и строки списка; фильтр работает; таблица не затронута.
4. **Жизненный цикл.** Граф строится при первом открытии вкладки; переключение вкладок сохраняет результат; «Повторить» работает для ошибки; новый архив сбрасывает граф; устаревший результат не показывается.
5. **Лимиты.** Файл больше 1 МиБ даёт `unknown` и предупреждение; превышение текста/узлов/рёбер даёт `GraphAnalysisError` с `limit` и `actual`; таблица остаётся доступной.
6. **Отображение.** При превышении хотя бы одного комфортного порога список открывается первым; в упрощённом графе «показано X из Y» корректно для узлов и рёбер; выше максимального порога доступен только полный список; клавиатура, фокус и экран 375 px работают; ошибок в консоли нет.
7. **Детерминизм и безопасность.** Два запуска на одном ZIP дают структурно одинаковый `GraphResult`; в результате нет исходного текста; `.env`, `obj/`, `bin/`, `.sln` не читаются.
8. **Совместимость.** `analyzeZipFile` проходит прежние тесты; `npm run check` зелёный; новые типы и ошибки не ломают существующие импорты.

## 11. Подтверждённые решения

Решения подтверждены человеком 2026-10-28:

- [x] Граф строится лениво, при первом открытии вкладки «Граф», а не сразу после анализа ZIP.
- [x] Неразрешённые ссылки — отдельный список, не рёбра и не фиктивные узлы.
- [x] Пороги отображения: 200 узлов / 500 рёбер — комфортно; 1000 / 3000 — максимум интерактивного графа.
- [x] Циклы в MVP не подсвечиваются отдельно.
- [x] Один пакет — один узел, версии хранятся массивом.
- [x] Для перехода в таблицу используется `tablePath` — исходная строка из `AnalysisResult.files`, найденная по нормализованному пути.
- [x] Лимиты графа: 1 МиБ на файл, 20 МиБ текста, 3000 узлов, 10 000 рёбер.
- [x] Отмены построения графа в MVP нет; устаревшие результаты игнорируются по токену.

## 12. Что учтено в спеках «после»

### UI

- Заменить «неизвестные связи» на «неразрешённые ссылки» там, где речь о `UnresolvedItem`.
- Добавить счётчики `excluded.objBin`, `excluded.otherTypes`, `excluded.total`.
- Добавить отображение условных рёбер и `condition`.
- Использовать `tablePath` для перехода в таблицу.
- Зафиксировать `notStarted` / `building` / `done` / `empty` / `error` / `limit`.
- Зафиксировать пороги отображения и поведение списка.

### Логика

- Добавить `tablePath` в `ProjectNode` и `SourceFileNode`.
- Добавить `stats.excluded`.
- Добавить `limit`, `actual`, `limitName` в `GraphAnalysisError`.
- Подтвердить, что `stats.unresolvedCount` — сумма `count`.
- Подтвердить отсутствие progress/cancel в MVP.
- Подтвердить, что `analyzeCsharpGraph` — основной API, а `analyzeProjectZip` — необязательная обёртка.

### Обе команды

- Сверить 3–5 условий приёмки с разделом 10.
- Убрать из спек детали, которые уже зафиксированы контрактом, и оставить ссылку на этот файл.
