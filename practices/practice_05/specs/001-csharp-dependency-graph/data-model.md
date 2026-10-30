# Data Model: Граф зависимостей C#-проекта

**Фича**: `001-csharp-dependency-graph` | **Дата**: 2026-10-28
**Источник**: [spec.md](./spec.md), [contract.md](./contract.md)

## Публичные типы

### Узлы

```ts
type NodeStatus = 'known' | 'partial' | 'unknown'

type GraphNodeBase = {
  id: string
  label: string
  status: NodeStatus
}

type ProjectNode = GraphNodeBase & {
  kind: 'project'
  path: string
  tablePath: string | null
  name: string                 // имя .csproj без расширения
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

`tablePath` — исходная строка из `AnalysisResult.files`, у которой нормализованный
путь совпадает с `path`; если таких строк несколько или нет — `null`.

Принадлежность `.cs` проекту: ближайший `.csproj` вверх по каталогам. Если
в каталоге несколько `.csproj`, выбирается первый по побайтовому порядку
нормализованного пути, а в `warnings` добавляется `MULTIPLE_PROJECTS_IN_DIR`.

### Статусы

- `source`: `known` — прочитан и разобран; `partial` — прочитан с замечанием
  разбора или пустым namespace; `unknown` — не прочитан (> 1 МиБ или ошибка чтения).
- `project`: `known` — `.csproj` прочитан и все исходники `known`; `partial` —
  есть `partial`/`unknown` исходник или замечание; `unknown` — `.csproj` не прочитан.
- `package`: всегда `known`.

`usingCount` — число using-директив в файле, включая `System` и повторы.
Массивы `namespaces`, `targetFrameworks` и `sourceFileIds` уникальны и
отсортированы побайтово; `versions` — `null` первым, затем строки побайтово.

`label`: проект — `name`; исходный файл — `path`; пакет — `packageId`
(в нижнем регистре).

Если две записи ZIP дают один нормализованный путь (сравнение без учёта
регистра), создаётся один узел; его `id` строится по первой по байтовому
порядку записи, `tablePath: null`, текст не читается, `status: 'unknown'`.
Путь добавляется в `paths` предупреждения `DUPLICATE_PATH`, а `count`
учитывает все записи с дубликатами.

### Рёбра

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

`certainty: 'conditional'` используется только для ссылок `.csproj` с
`Condition`/`Choose/When`; вложенные условия объединяются через ` && `
от внешнего к внутреннему; `#if` в `.cs` не вычисляется, using внутри всех
ветвей считаются присутствующими. Для не-условных рёбер `condition: null`;
для ссылок без версии `packageVersion: null`; `namespace` отсутствует только
у не-using рёбер. Это делает `id` детерминированным.

### Неразрешённые ссылки

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
  message: string
}
```

Одинаковые ссылки агрегируются по `<kind>|<fromId>|<target>|<reason>`;
`count` — число вхождений, включая повторные `using`. `fromId` всегда указывает
на существующий узел.

### Результат

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

`warnings` содержит не более одной записи на код; `paths` — все затронутые
нормализованные пути, уникальные и отсортированные побайтово. `count`:

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
  unresolvedCount: number
  excluded: { objBin: number; otherTypes: number; total: number }
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

`archiveName` совпадает с `AnalysisResult.archiveName`.

Счётчики:

- `projectCount`, `sourceFileCount`, `packageCount` — число узлов соответствующего `kind`;
- `namespaceCount` — уникальные объявленные namespace (с учётом регистра);
- `systemUsingCount` — уникальные пары `(fromId, target)` для `System`/`System.*`,
  включая `using static` и alias;
- `externalUsingCount` — уникальные пары `(fromId, target)` для `using` без точного
  namespace, кроме `System`/`System.*`, включая `using static` и alias;
- `unresolvedCount` — сумма `count` по всем `UnresolvedItem`.

Дубликаты путей не входят в `excluded`: они отражены предупреждением
`DUPLICATE_PATH`. `excluded.total === excluded.objBin + excluded.otherTypes`.

## Внутренние типы (не выходят из `src/lib/graph/`)

```ts
type ZipSourceFile = {
  originalPath: string        // точная строка из AnalysisResult.files
  path: string                // нормализованный путь
  ext: 'cs' | 'csproj'
  size: number
}

type ReadSourceFile = ZipSourceFile & {
  text: string | null         // null, если файл больше maxFileBytes
  status: NodeStatus
}

type UsingRef = {
  target: string              // namespace или alias-цель
  isStatic: boolean
  alias: string | null
  scopeNamespace: string | null // только для file-scoped namespace
  line: number
}

type ParsedCsFile = {
  namespaces: string[]
  usings: UsingRef[]
  issue: string | null
}

type ProjectRef = {
  include: string
  condition: string | null
}

type PackageRef = {
  id: string
  version: string | null
  condition: string | null
}

type ParsedProjectFile = {
  name: string
  targetFrameworks: string[]
  projectRefs: ProjectRef[]
  packageRefs: PackageRef[]
  issue: string | null
}
```

## Идентификаторы

| Сущность | Формат |
| --- | --- |
| Проект | `project:<нормализованный путь>` |
| Исходный файл | `file:<нормализованный путь>` |
| Пакет | `package:<id в нижнем регистре>` |
| Ребро | `from|to|kind|namespace|packageVersion|condition`; отсутствующие значения — пустая строка, `\` и `|` экранируются |
| Неразрешённая ссылка | `<kind>|<fromId>|<target>|<reason>`; `\` и `|` экранируются |

Нормализация пути: заменить `\` на `/`, свернуть повторные `/` и сегменты `.`,
свернуть `..` внутри архива, сравнивать без учёта регистра. Абсолютные пути,
диск и выход за корень отбрасываются; отображение сохраняет исходный регистр.

## Правила целостности

1. `id` уникален в пределах своего массива.
2. `from` и `to` каждого ребра существуют в `nodes`.
3. Неразрешённые ссылки не входят в `edges`.
4. `stats.nodeCount === nodes.length`, `stats.edgeCount === edges.length`;
   `stats.nodeCount === projectCount + sourceFileCount + packageCount`.
5. `stats.unresolvedCount === sum(unresolved[].count)`.
6. `tablePath === null` или является строкой из `AnalysisResult.files`,
   у которой нормализованный путь совпадает с `path`.
7. `ProjectNode.sourceFileIds` содержит только существующие `SourceFileNode.id`.
8. `versions` не содержит дубликатов и отсортирован (`null` первым).
9. В результате нет исходного текста файлов, литералов и HTML.
10. `warnings`, `paths` и `candidates` отсортированы детерминированно; `candidates` без дублей.
11. Рёбра дедуплицированы по `(from, to, kind, namespace, packageVersion, condition)`; `from !== to`.
12. `using` на namespace, объявленный в том же файле, не создаёт рёбер
    ни к одному файлу и не попадает в `unresolved`.
13. `namespaces`, `targetFrameworks` и `sourceFileIds` уникальны и отсортированы побайтово.
14. `UnresolvedItem` агрегирует повторы по `<kind>|<fromId>|<target>|<reason>`;
    `count` — число вхождений, `warnings` содержит не более одной записи на код.

## Сортировка

- Узлы: `project`, `source`, `package`, затем `id`.
- Рёбра: `from`, `to`, `kind`, затем `id`.
- Неразрешённые: `kind`, `fromId`, `target`, затем `id`.
- Предупреждения: `code`, первый путь, `count`.
- Сортировка — побайтовая, без `localeCompare`, чтобы результат не зависел от локали.

## Состояния UI

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

```text
notStarted --открыть вкладку--> building
building --GraphResult--> done
building --NO_CSHARP_FILES / nodes=0--> empty
building --жёсткий лимит--> limit
building --прочая ошибка--> error
error --Повторить--> building
limit/empty --Повторить недоступно--> limit/empty
любое --новый архив--> notStarted
```

`partial` и `large` — не состояния вкладки: первый добавляет баннер, второй
меняет режим отображения. `NodeStatus.partial` — отдельное поле узла.

## Валидация

- `.cs`/`.csproj` без учёта регистра; `obj`/`bin` — сегменты пути без учёта регистра.
- Файлы с небезопасным путём (абсолютный, диск, `..` за корень) не читаются
  и входят в `excluded.otherTypes`.
- `ProjectReference Include` разрешается относительно каталога `.csproj`;
  абсолютный путь, диск или выход за корень → `unresolved` `PROJECT_NOT_FOUND`.
- MSBuild-свойства в путях и версиях не раскрываются: ссылка с нераскрытым
  путём → `PROJECT_NOT_FOUND`, версия сохраняется как текст.
- Файл > `maxFileBytes` не декодируется: узел `unknown`, предупреждение
  `FILE_TOO_LARGE`, проект и файл остаются в графе.
- Суммарный размер текста в UTF-8 байтах > `maxTextBytes` → `LIMIT_TEXT_BYTES`
  до построения рёбер.
- `nodes.length > maxNodes` → `LIMIT_NODES`; `edges.length > maxEdges` → `LIMIT_EDGES`.
- `using` на `System`/`System.*` не создаёт ребра; учитывается в `systemUsingCount`.
- Namespace сравнивается с учётом регистра; пути — без учёта регистра.
- Точное совпадение namespace даёт рёбра ко всем файлам, объявившим его,
  если namespace не объявлен в самом файле-источнике; иначе ссылка не даёт рёбер.
- Совпадение только в другом регистре → `NAMESPACE_CASE_MISMATCH`, без ребра.
- Нет точного совпадения, но есть namespace с этим префиксом → `NAMESPACE_NOT_FOUND`, без ребра.
- `using static` не создаёт ребра и даёт `STATIC_USING_UNSUPPORTED`, кроме
  `System`/`System.*`; кандидаты — объявленные namespace-префиксы цели,
  от длинного к короткому.
- Alias без точного namespace → `ALIAS_TARGET_UNSUPPORTED`, без ребра;
  исключение — `System`/`System.*`.
- `System`/`System.*` не создают ни ребра, ни `unresolved` — только `systemUsingCount`.
- Повторные `using` не создают дубликатов рёбер; у неразрешённых ссылок
  повторы агрегируются, `count` — число вхождений.
- Пустой или отсутствующий namespace — узел `partial`, предупреждение
  `EMPTY_NAMESPACE`, без фиктивных рёбер.
- `warnings` отсортированы по `code`, затем по первому пути и `count`;
  `paths` и `candidates` отсортированы побайтово и не содержат дублей.
- `versions` отсортированы: `null` первым, затем строки побайтово.
