Спецификация логики: граф зависимостей C#-проекта
Версия: «до» — предложение команды логики до согласования общего контракта.  
Границы: только вычисление графа. Экраны, состояния интерфейса и библиотека визуализации не проектируются.  
Статус: код не менялся, проверки не запускались.
1. Вход и отбор файлов
На вход подаётся ZIP как File и результат уже выполненного analyzeZipFile — AnalysisResult.
Читаем только записи, которые одновременно:
- не являются каталогами;
- имеют расширение .cs или .csproj без учёта регистра;
- не находятся внутри obj/ или bin/ на любом уровне вложенности (сегменты пути сравниваются без учёта регистра);
- имеют безопасный нормализованный путь.
Игнорируем, не открывая содержимое:
- все остальные расширения, включая .sln, .props, .targets, .csproj.user, .json, .env, ключи, сертификаты;
- каталоги и служебные записи ZIP;
- файлы в obj/, bin/;
- пути с абсолютным началом, диском (C:), выходом за корень через .. или недопустимыми символами.
.sln для MVP не нужен: проекты и их связи восстанавливаются по .csproj, принадлежность .cs — эвристикой по ближайшему каталогу проекта.
Текст декодируем как UTF-8 (с BOM и без), UTF-16 LE/BE с BOM. BOM отбрасывается. Неподдержанная кодировка или ошибка чтения переводит файл в unknown, граф продолжает строиться. Содержимое файлов не сохраняется в результате и не логируется.
Если после фильтрации нет ни одного .cs и ни одного .csproj, возвращается ошибка NO_CSHARP_FILES.
2. Модель данных
type NodeStatus = 'known' | 'partial' | 'unknown'

type ProjectReference = {
  includeRaw: string
  conditional: boolean
  conditionRaw: string | null
}

type PackageReference = {
  idRaw: string
  id: string                    // lower-case для идентичности
  versionRaw: string | null
  version: string | null        // без разрешения диапазонов
  conditional: boolean
  conditionRaw: string | null
}

type Project = {
  path: string
  name: string
  targetFrameworks: string[]
  rootNamespace: string | null
  projectReferences: ProjectReference[]
  packageReferences: PackageReference[]
  sourceFilePaths: string[]
  status: NodeStatus
  unknownReason: string | null
}

type UsingDirective = {
  kind: 'normal' | 'global' | 'static' | 'alias'
  target: string                // namespace или тип, нормализованно
  alias: string | null
  scopeNamespace: string | null // namespace-блок, где встретился using
  conditional: boolean          // внутри #if/#elif/#else
}

type SourceFile = {
  path: string
  projectPath: string | null
  namespaces: string[]
  usings: UsingDirective[]
  sizeBytes: number
  status: NodeStatus
  unknownReason: string | null
}

type ExternalPackage = {
  id: string                    // lower-case
  name: string                  // первое встреченное написание
  versions: Array<string | null>
  projectPaths: string[]
}
Project и SourceFile — результаты парсинга; в GraphResult они проецируются в узлы без дублирования сырого текста.
type GraphNodeBase = {
  id: string
  label: string
  status: NodeStatus
}

type ProjectNode = GraphNodeBase & {
  kind: 'project'
  path: string
  name: string
  targetFrameworks: string[]
  sourceFileIds: string[]
}

type SourceFileNode = GraphNodeBase & {
  kind: 'source'
  path: string
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

type GraphEdge = {
  id: string
  from: string
  to: string
  kind: 'project-reference' | 'package-reference' | 'using'
  certainty: 'declared' | 'namespace-match' | 'conditional'
  namespace?: string
  scopeNamespace?: string | null
  alias?: string
  packageVersion?: string | null
  condition?: string | null
}

type UnresolvedItem = {
  id: string
  kind: 'using' | 'project-reference' | 'package-reference' | 'file'
  reason:
    | 'NAMESPACE_NOT_FOUND'
    | 'NAMESPACE_CASE_MISMATCH'
    | 'EXTERNAL_NAMESPACE'
    | 'STATIC_USING_UNSUPPORTED'
    | 'ALIAS_TARGET_UNSUPPORTED'
    | 'PROJECT_NOT_FOUND'
    | 'PROJECT_PATH_DYNAMIC'
    | 'PROJECT_PATH_AMBIGUOUS'
    | 'PROJECT_PATH_UNSAFE'
    | 'PROJECT_SELF_REFERENCE'
    | 'PACKAGE_ID_INVALID'
    | 'PACKAGE_ID_DYNAMIC'
    | 'FILE_TOO_LARGE'
    | 'FILE_DECODE_ERROR'
    | 'FILE_READ_ERROR'
    | 'FILE_PATH_UNSAFE'
  fromId: string | null
  target: string
  candidates: string[]
  count: number
  message: string              // по-русски, без фрагментов кода
}

type GraphResult = {
  archiveName: string
  nodes: GraphNode[]
  edges: GraphEdge[]
  unresolved: UnresolvedItem[]
  stats: {
    projectCount: number
    sourceFileCount: number
    packageCount: number
    nodeCount: number
    edgeCount: number
    namespaceCount: number
    systemUsingCount: number
    externalUsingCount: number
    unresolvedCount: number
  }
  warnings: Array<{
    code: string
    message: string
    paths: string[]
    count: number
  }>
}
Идентификаторы стабильны:
- проект: project:<нормализованный путь>;
- файл: file:<нормализованный путь>;
- пакет: package:<lower-case id>;
- ребро: from|to|kind|namespace/version/condition.
Массивы сортируются детерминированно: узлы — по kind, затем по id; рёбра — по from, to, kind; unresolved — по kind, fromId, target. Сортировка порядковая, не зависит от локали.
3. Правила зависимостей
3.1. .csproj
Разбираем XML линейным сканером без DOMParser и без DOM:
- пропускаем комментарии, CDATA, processing instructions, DOCTYPE;
- не раскрываем внешние сущности и не выполняем DTD;
- декодируем только стандартные XML-сущности;
- имена элементов и атрибутов сравниваем без учёта регистра;
- свойства MSBuild ($(...), @(...), %(...)) не вычисляем.
ProjectReference:
- берём Include; путь относительный к каталогу проекта;
- нормализуем \ → /, убираем . и .., схлопываем //;
- ищем точное совпадение пути среди .csproj архива;
- если точного нет, но есть ровно одно совпадение без учёта регистра — создаём ребро и предупреждение CASE_INSENSITIVE_PROJECT_PATH;
- если совпадений несколько — PROJECT_PATH_AMBIGUOUS, ребра нет;
- если путь динамический, абсолютный, выходит за корень или не найден — соответствующая запись в unresolved, ребра нет;
- ссылка проекта на себя — PROJECT_SELF_REFERENCE, ребра нет;
- дубликаты с одинаковым путём и условием дают одно ребро;
- Condition не вычисляем: ребро создаётся с certainty: 'conditional' и исходным текстом условия.
PackageReference:
- берём Include; Update и Remove не являются зависимостями;
- ID сравниваем без учёта регистра, в узле храним первое написание;
- версия: VersionOverride, затем атрибут Version, затем дочерний <Version>; диапазоны не разрешаем;
- отсутствующая версия допустима (null), это не ошибка;
- динамический ID — PACKAGE_ID_DYNAMIC, узел не создаётся;
- пакет всегда внешний: узел создаётся, ребро идёт от проекта к пакету;
- версия на ребре позволяет показать разные версии одного пакета в разных проектах;
- Condition сохраняется, ребро получает certainty: 'conditional'.
Reference, FrameworkReference, Analyzer, Import, центральное управление версиями (Directory.Packages.props) в MVP не разворачиваются. Проект при наличии Import или условий получает status: 'partial' и предупреждение. Неподдержанные элементы не создают узлов и рёбер.
Ошибка разбора .csproj не роняет граф: проект получает status: 'unknown', ссылки не извлекаются, добавляется предупреждение.
3.2. .cs
Используем лексер, а не регулярные выражения по всему файлу. Обязательно маскируем:
- // и /* ... */;
- обычные, verbatim, интерполированные и raw-строки;
- символьные литералы.
Это не позволяет принимать using и namespace внутри строк и комментариев за реальные директивы.
Поддерживаем:
- namespace A.B; — file-scoped;
- namespace A.B { ... } — block-scoped;
- вложенные namespace A { namespace B { ... } } → A, A.B;
- несколько namespace в одном файле;
- @-идентификаторы (при сравнении @ отбрасывается);
- using N;, global using N;;
- using static A.B.C;;
- using X = A.B;, global using X = A.B;;
- using global::A.B;.
#if/#elif/#else не вычисляем. Директивы внутри условных блоков собираем, но помечаем conditional: true; это касается и рёбер. #region игнорируем. Наличие условной компиляции даёт файлу status: 'partial' и предупреждение.
Scope using:
- using на верхнем уровне и global using действуют на весь файл;
- using внутри namespace-блока получает scopeNamespace;
- для файлового графа ребро всё равно идёт от файла, но scopeNamespace сохраняется для диагностики.
3.3. Связывание using с файлами
Строим индекс namespace → множество файлов, объявивших этот namespace. Сравнение namespace точное, с учётом регистра — как в C#.
Для каждого обычного или global using:
- если namespace объявлен в архиве, создаём рёбра от исходного файла к каждому файлу, объявившему namespace;
- ребро имеет kind: 'using', certainty: 'namespace-match', namespace;
- рёбра дедуплицируются по (from, to, namespace);
- ребро файла к самому себе не создаётся;
- using, находящийся в области того же namespace, считается избыточным и рёбер не создаёт.
using static:
- тип не анализируем, поэтому ребро не создаём;
- добавляем STATIC_USING_UNSUPPORTED с кандидатами — файлами, объявившими родительский namespace;
- для System.* запись не создаётся.
Alias:
- если правая часть точно совпадает с объявленным namespace — создаём ребро namespace-match с alias;
- иначе ALIAS_TARGET_UNSUPPORTED; если есть файлы с родительским namespace или совпадением без учёта регистра, перечисляем их в candidates;
- алиасы типов без семантического анализа не разрешаем.
Несколько namespace в файле: файл является целью для каждого объявленного namespace. Partial-классы не объединяем: каждый файл — отдельный узел и отдельная цель. Это осознанно грубее типа: ребро доказывает связь на уровне namespace, а не конкретного класса.
3.4. Регистр, слэши, дубликаты, пути
Пути ZIP нормализуем: \ → /, удаление ./, схлопывание //, разворачивание . и .., запрет выхода за корень. Исходное написание сохраняется только в диагностике.
- Идентичность файлов — по точному нормализованному пути.
- Точные дубликаты записей ZIP: берём первую, добавляем DUPLICATE_ENTRY.
- Пути, различающиеся только регистром, считаются разными файлами; добавляем предупреждение.
- Для ProjectReference допускаем единственное совпадение без учёта регистра как fallback.
- Namespace сравниваем с учётом регистра. Если есть только совпадение в другом регистре, ребра нет, но добавляем NAMESPACE_CASE_MISMATCH с кандидатами.
- Дубликаты using, namespace, ProjectReference и PackageReference дедуплицируются.
Принадлежность .cs проекту:
- ближайший каталог-предок, содержащий ровно один .csproj;
- если в этом каталоге проектов несколько — projectId: null и предупреждение;
- если проекта нет — файл всё равно узел и участвует в namespace-индексе;
- <Compile Include/Remove> не вычисляем: принадлежность эвристическая, это фиксируется предупреждением.
3.5. Системные и внешние namespace
System и System.* считаются системными: рёбер и записей unresolved не создают, только увеличивают systemUsingCount. Microsoft.* автоматически системным не считается.
Если namespace не объявлен в архиве и не системный:
- ребра нет;
- создаётся EXTERNAL_NAMESPACE;
- в candidates можно перечислить ID пакетов проекта, если namespace совпадает с ID или начинается с ID + '.'; это подсказка, а не доказанное ребро;
- внешние using агрегируются по (файл, namespace), чтобы не раздувать результат.
Пакеты не связываются с файлами автоматически: единственное доказанное ребро пакета — PackageReference из .csproj.
3.6. Циклы
Циклы project reference и using разрешены и сохраняются в графе. Ошибкой не являются, не разрываются и не топологически сортируются. Обход итеративный, с посещёнными множествами; рекурсия по графу отсутствует, поэтому циклы не приводят к зависанию или переполнению стека. UI не должен предполагать DAG.
3.7. Неразрешённые ссылки
Неразрешённое не дорисовывается. Оно попадает в unresolved с причиной, исходным узлом, целью, кандидатами и количеством. Для файлов, которые не удалось прочитать, создаётся узел unknown с unknownReason; для ссылок — запись без ребра. Сообщения на русском, без фрагментов исходного кода.
4. Что не входит в MVP
- Roslyn, компиляция, семантическая модель, разрешение типов и методов.
- Выполнение загруженного кода, reflection, dynamic, DI, анализ вызовов.
- using static и алиасы типов с точным разрешением.
- Анализ Compile Include/Remove, Directory.Build.props/targets, Directory.Packages.props, центральное управление версиями.
- Reference, FrameworkReference, Analyzer, кастомные MSBuild-таргеты.
- .sln как обязательный источник; при наличии игнорируется.
- Вычисление условий MSBuild и препроцессора.
- Транзитивное разрешение версий NuGet и семантические конфликты версий.
- Namespace-узлы, типы, классы, методы.
- Серверная обработка, сеть, внешние API, ИИ.
5. Лимиты
Базовые лимиты ZIP сохраняются без изменений:
Лимит	Значение	Поведение
Размер ZIP	20 МиБ	ZipAnalysisError('LIMIT_ZIP_SIZE')
Записей ZIP, включая каталоги	2000	LIMIT_ENTRIES
Суммарный несжатый объём	100 МиБ	LIMIT_UNCOMPRESSED
Новые лимиты графа:
Лимит	Значение	Поведение
Один .cs или .csproj	1 МиБ	мягкий: файл не читается, узел unknown, предупреждение, граф продолжается
Суммарный текст .cs + .csproj	20 МиБ	GraphAnalysisError('LIMIT_TEXT_BYTES'), граф не возвращается
Узлы	3000	LIMIT_NODES, граф не возвращается
Рёбра	10 000	LIMIT_EDGES, граф не возвращается
Проверка размера файла выполняется по данным центрального каталога до чтения и повторно после декодирования. Текст читается последовательно, по одному файлу, чтобы не держать весь архив в памяти.
При превышении жёсткого лимита возвращается понятная ошибка с числом; частичный граф не маскирует превышение. Мягкий лимит всегда виден как unknown и предупреждение. Значения хранятся в limits.ts и доступны UI для отображения; для тестов допускается Partial<GraphLimits>.
6. API и контракт
Публичный API:
export const GRAPH_LIMITS: GraphLimits

export class GraphAnalysisError extends Error {
  code:
    | 'NO_CSHARP_FILES'
    | 'LIMIT_TEXT_BYTES'
    | 'LIMIT_NODES'
    | 'LIMIT_EDGES'
    | 'INPUT_MISMATCH'
}

export async function analyzeCsharpGraph(
  file: File,
  analysis: AnalysisResult,
  limits?: Partial<GraphLimits>
): Promise<GraphResult>

export async function analyzeProjectZip(
  file: File,
  limits?: Partial<Limits & GraphLimits>
): Promise<{ analysis: AnalysisResult; graph: GraphResult }>
analyzeZipFile остаётся без изменений. analyzeCsharpGraph получает уже готовый AnalysisResult, переоткрывает ZIP и читает только отобранные .cs/.csproj; вызывающая сторона обязана передать результат от того же файла. При несовпадении — INPUT_MISMATCH. analyzeProjectZip — удобная обёртка: сначала analyzeZipFile, затем граф; при ошибке графа таблица вызывающей стороне не возвращается, поэтому UI рекомендуется двухшаговый вызов.
Чистые функции для тестов и повторного использования:
export function parseCsprojText(path: string, text: string): Project
export function parseCsharpText(path: string, text: string): SourceFile
export function buildGraphFromParsed(
  archiveName: string,
  projects: Project[],
  sources: SourceFile[],
  limits?: Partial<GraphLimits>
): GraphResult
parse* и buildGraphFromParsed не выполняют I/O, не используют DOM, document, window, React, eval, new Function и не меняют входные данные. analyze* — единственная граница с File и zip.js.
Ошибки:
- ZipAnalysisError — существующие ошибки ZIP, пробрасываются без изменения кодов и текстов;
- GraphAnalysisError — только перечисленные коды;
- ошибка отдельного файла не является исключением: узел unknown плюс предупреждение;
- ошибка разбора .csproj — unknown проект плюс предупреждение.
Результат детерминирован: одинаковый ZIP и лимиты дают структурно одинаковый GraphResult.
7. Производительность и безопасность
- Сложность — около O(размер текста + число using + число рёбер), без квадратичных проходов.
- Namespace-индекс и индекс путей — Map/Set; поиск в среднем O(1).
- Чтение ZIP последовательное; после парсинга сырой текст освобождается и в результат не попадает.
- Лексер и XML-сканер линейные, без катастрофического backtracking.
- Граф обходится итеративно; циклы безопасны.
- Загруженный код не выполняется, не импортируется, не компилируется; нет eval, new Function, динамического import содержимого архива.
- Нет сети, телеметрии, логирования содержимого и передачи архива куда-либо.
- Читаются только .cs/.csproj; секретоподобные файлы не открываются. Строковые литералы маскируются и не возвращаются.
- XML не раскрывает DTD и внешние сущности.
- Пути нормализуются; небезопасные пропускаются.
- Логика возвращает обычные строки, не HTML; экранирование при выводе — обязанность UI. В сообщениях об ошибках нет фрагментов кода и секретов.
- Ограничения памяти обеспечиваются лимитами; остаточный риск ZIP с ложным uncompressedSize фиксируется как известное ограничение.
8. Проверяемые условия приёмки
1. Проекты, пакеты, using. ZIP с A/A.csproj (ProjectReference на ..\B\B.csproj), B/B.csproj (PackageReference на Newtonsoft.Json 13.0.3), A/Program.cs (using B.Services;) и B/Services/Foo.cs (namespace B.Services;) даёт рёбра A→B, B→Newtonsoft.Json, Program.cs→Foo.cs с namespace-match; using System; не создаёт ребра и не попадает в unresolved.
2. Пути, регистр, дубликаты. ..\B\b.csproj находит единственный B/B.csproj без учёта регистра и даёт предупреждение; повторные ProjectReference и PackageReference дают одно ребро; ..\..\..\X.csproj и $(Dynamic)\X.csproj попадают в unresolved без ребра; точный дубликат записи ZIP даёт один узел и предупреждение.
3. Конструкции C#. Файл с двумя namespace, file-scoped и вложенным namespace, partial-классом в двух файлах, global using, using static и alias: обычные и global using дают рёбра; static — STATIC_USING_UNSUPPORTED; alias разрешается только при точном совпадении с объявленным namespace; namespace с другим регистром не связывается, но попадает в unresolved с кандидатом; using внутри строки или комментария игнорируется.
4. Лимиты. .cs больше 1 МиБ даёт узел unknown с причиной FILE_TOO_LARGE, граф возвращается; суммарный текст больше 20 МиБ — LIMIT_TEXT_BYTES; больше 3000 узлов — LIMIT_NODES; больше 10 000 рёбер — LIMIT_EDGES; существующие ошибки ZIP и их тексты не меняются.
5. Безопасность и регрессия. .env, appsettings.json, obj/, bin/, .sln не читаются: fake-using в них не создаёт рёбер; analyzeZipFile проходит прежние тесты; два запуска дают структурно одинаковый результат; в GraphResult нет исходного текста и строковых литералов; чистые парсеры работают в Node без DOM.
9. Открытые вопросы к UI и общему контракту
К UI:
- Направление ребра: предлагается «зависимый → зависимость». Подтвердить отображение стрелок.
- Как показывать unknown/partial узлы, unresolved и предупреждения; нужны ли группировка и фильтры.
- Нужна ли агрегация рёбер using по проектам: namespace может объявляться десятками файлов, и file-to-file рёбра будут плотными.
- Нужно ли подсвечивать циклы. Если да — добавить в контракт cycles: string[][] или отдельный признак.
- Как показывать конфликт версий пакета: один узел с несколькими версиями или отдельные узлы.
- Нужны ли подсказки candidatePackageIds для внешних namespace или достаточно счётчика.
- Допустимо ли, что построение графа выполняется в основном потоке и может занимать заметное время; нужны ли прогресс и отмена.
- Какой экран показывать при NO_CSHARP_FILES и при жёстком лимите.
К контракту:
- Подтвердить значения лимитов: 1 МиБ на файл, 20 МиБ текста, 3000 узлов, 10 000 рёбер.
- Подтвердить модель «мягкий лимит на файл — unknown, жёсткие лимиты — ошибка».
- Подтвердить, что analyzeCsharpGraph принимает AnalysisResult, а UI использует двухшаговый вызов; нужна ли обёртка analyzeProjectZip.
- Подтвердить эвристику принадлежности .cs ближайшему .csproj без разбора Compile.
- Подтвердить отсутствие namespace-узлов и file-to-file рёбра namespace-match.
- Подтвердить, что global using даёт ребро только от файла, где он объявлен, а не от всех файлов проекта.
- Подтвердить частичную поддержку кодировок: UTF-8 и UTF-16 с BOM.
- Согласовать коды ошибок, коды предупреждений и русские формулировки.
- Подтвердить, что .sln не используется и не обязателен.
10. Что сохраняется от старого поведения
- analyzeZipFile, AnalysisResult, ZipEntryInfo, ZipAnalysisError, LIMITS, formatBytes не меняются.
- Таблица по-прежнему показывает все файлы архива: путь, расширение, размер; граф не заменяет и не фильтрует её.
- Сортировка файлов по пути и подсчёт fileCount/totalUncompressedBytes сохраняются.
- Лимиты 20 МиБ / 2000 записей / 100 МиБ и тексты ошибок сохраняются.
- Ошибка или ограничение графа не должны уничтожать уже показанную таблицу; поэтому предпочтителен двухшаговый вызов.
- Новые типы, лимиты и ошибки добавляются отдельно и не ломают существующие импорты.