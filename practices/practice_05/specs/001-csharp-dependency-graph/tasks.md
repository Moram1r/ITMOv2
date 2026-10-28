# Tasks: Граф зависимостей C#-проекта

**Input**: Design documents from `/specs/001-csharp-dependency-graph/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/graph-api.md](./contracts/graph-api.md)

**Tests**: включены, потому что конституция (принцип VII) требует тестов логики
и проверки границ. Тесты писать до реализации и убеждаться, что они падают.

**Organization**: задачи сгруппированы по пользовательским историям из `spec.md`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: можно выполнять параллельно (разные файлы, нет зависимостей)
- **[Story]**: к какой истории относится задача (US1, US2, US3)
- В описании — точный путь к файлу

## Path Conventions

Проект — `project/` в корне `practice_05`; исходники в `project/src/`,
тесты в `project/test/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: зависимость, лимиты, типы и утилиты путей.

- [x] T001 Установить `@xyflow/react` в `project/` (`npm install @xyflow/react`), проверить `project/package.json` и lockfile
- [x] T002 Добавить `GRAPH_LIMITS` (1 МиБ, 20 МиБ, 3000, 10 000) и `GRAPH_DISPLAY_LIMITS` (200/500/1000/3000) в `project/src/lib/limits.ts` (после T003)
- [x] T003 [P] Создать публичные типы графа из `data-model.md` в `project/src/lib/graph/types.ts`
- [x] T004 [P] Создать нормализацию путей (повторные `/` и `.`, небезопасные абсолютные, диск и `..` за корень), `extOf`, проверку `obj/`/`bin/`, поиск ближайшего `.csproj` и `tablePath` в `project/src/lib/graph/paths.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: парсеры и чтение ZIP, без которых не работает ни одна история.

**⚠️ CRITICAL**: до завершения этой фазы истории не начинать.

- [x] T005 [P] Создать генератор ZIP-фикстур и polyfill `File` в `project/test/graph-fixtures.ts`
- [x] T006 [P] Написать падающие тесты парсеров в `project/test/graph-parser.test.ts`: using/namespace, `using static`, alias, комментарии, литералы, XML-комментарии, using внутри `#if`, вложенные `Condition` (от внешнего к внутреннему), версия пакета атрибутом и дочерним элементом, несколько `TargetFramework`
- [x] T007 [P] Реализовать снятие комментариев/литералов, извлечение `using`/`using static`/alias/`namespace` и `issue` в `project/src/lib/graph/cs-parser.ts`
- [x] T008 [P] Реализовать сканер `.csproj` с `ProjectReference` (разрешение относительно каталога проекта), `PackageReference` (версия атрибутом или элементом), `Condition` (вложенные через ` && ` от внешнего к внутреннему), игнорированием XML-комментариев, TFM и `issue` в `project/src/lib/graph/csproj-parser.ts`
- [x] T009 [P] Реализовать чтение только `.cs`/`.csproj` из ZIP с лимитом файла, суммарным текстом, `excluded` и предупреждением `FILE_TOO_LARGE` в `project/src/lib/graph/zip-source.ts`
- [x] T010 Запустить `npm run test -- graph-parser` в `project/` и довести тесты парсеров до зелёного

**Checkpoint**: парсеры и чтение ZIP готовы, можно начинать US1.

---

## Phase 3: User Story 1 - Построить граф и увидеть структуру проекта (Priority: P1) 🎯 MVP

**Goal**: ZIP с C#-проектом даёт граф с проектами, файлами, пакетами и связями;
таблица и сводка сохраняются.

**Independent Test**: загрузить Demo ZIP из `quickstart.md`, открыть «Граф»,
проверить 2 проекта, 2 файла, 1 пакет и ожидаемые рёбра.

### Tests for User Story 1

- [x] T011 [P] [US1] Написать падающие тесты сборки графа в `project/test/graph-builder.test.ts`: проекты, пакеты и версии, using, точный регистр namespace, `NAMESPACE_CASE_MISMATCH`, `using static`/alias, `System` без unresolved, условные рёбра и `condition`, циклы, несколько файлов с одним namespace, отсутствие self-edge и дублей, статусы (включая пустой namespace → `partial`), подписи узлов (`label`), `count` повторов unresolved, все счётчики, `tablePath`, дубликаты путей (один узел `unknown`, `tablePath: null`), нормализация путей, `INPUT_MISMATCH`, `DUPLICATE_PATH`/`MULTIPLE_PROJECTS_IN_DIR` (выбор первого `.csproj` побайтово)/`PARSE_ISSUE`, небезопасный `ProjectReference`, детерминизм, уникальность `id` ребра при условии с `|`, отсутствие исходного текста в результате, русские сообщения без фрагментов кода
- [x] T012 [P] [US1] Написать падающие тесты лимитов в `project/test/graph-limits.test.ts`: `NO_CSHARP_FILES` (включая архив только с небезопасными путями), файл > 1 МиБ, текст в UTF-8 байтах, узлы, рёбра с проверкой `limit`/`actual`/`limitName` (`maxTextBytes`/`maxNodes`/`maxEdges`), `.env`/ключи не читаются, `obj/`/`bin/` и другие типы попадают только в `excluded`, небезопасные пути входят в `excluded.otherTypes`

### Implementation for User Story 1

- [x] T013 [US1] Реализовать `analyzeCsharpGraph`, `analyzeProjectZip`, `GraphAnalysisError` с кодами, полями и русскими `message`, статусы узлов, счётчики по определениям из `data-model.md`, дедупликацию рёбер, `unresolved` и `warnings` (`DUPLICATE_PATH`, `MULTIPLE_PROJECTS_IN_DIR`, `EMPTY_NAMESPACE`, `PARSE_ISSUE`) в `project/src/lib/graph/build-graph.ts`
- [x] T014 [P] [US1] Реализовать детерминированную слоистую раскладку с BFS по компонентам и обработкой циклов в `project/src/lib/graph/layout.ts`
- [x] T015 [US1] Экспортировать API и типы из `project/src/lib/graph/index.ts`
- [x] T016 [US1] Реализовать React Flow-представление с zoom/pan и выбором в `project/src/ui/GraphView.tsx`
- [x] T017 [P] [US1] Реализовать список узлов/рёбер и счётчики в `project/src/ui/GraphList.tsx`
- [x] T018 [US1] Реализовать ленивый запуск, состояния, default-экспорт и хранение результата в `project/src/ui/GraphTab.tsx`
- [x] T019 [US1] Добавить вкладки «Файлы»/«Граф» (по умолчанию «Файлы»), ленивую загрузку `GraphTab` через `React.lazy` + `Suspense`, сохранение панели смонтированной после первого открытия и сброс анализа, графа, выбора, фильтра и масштаба в `project/src/ui/App.tsx`
- [x] T020 [US1] Добавить стили вкладок, графа, списка и переключателя «Список»/«Граф» в `project/src/styles.css`
- [x] T021 [US1] Запустить `npm run check` в `project/`, пройти сценарий 1 из `quickstart.md` и замерить построение (≤ 5 с), переключение вкладок и сброс (≤ 1 с)

**Checkpoint**: US1 полностью работает и проверена отдельно.

---

## Phase 4: User Story 2 - Разобраться в узле и проверить файл (Priority: P2)

**Goal**: выбор узла/ребра/ссылки показывает детали и позволяет перейти
к строке таблицы.

**Independent Test**: выбрать `.cs`-узел, увидеть связи, нажать
«Показать в таблице файлов», вернуться с сохранённым выбором.

- [x] T022 [US2] Реализовать панель деталей узла/ребра/неразрешённой ссылки, включая `condition` у условных рёбер и версии пакета, в `project/src/ui/GraphDetails.tsx`
- [x] T023 [US2] Связать `GraphSelection` с `GraphTab.tsx` и `GraphView.tsx`
- [x] T024 [US2] Переключать на «Файлы» и подсвечивать строку по `tablePath` в `project/src/ui/App.tsx`
- [x] T025 [US2] Добавить клавиатурную навигацию и видимый фокус в `project/src/ui/GraphView.tsx`, `project/src/ui/GraphList.tsx`, `project/src/ui/GraphDetails.tsx`
- [x] T026 [US2] Сделать вертикальную раскладку графа и деталей на экране 375 px в `project/src/styles.css`
- [x] T027 [US2] Пройти Playwright-сценарий 2 из `quickstart.md`, проверить консоль, сделать скриншот и запустить `npm run check`

**Checkpoint**: US1 и US2 работают независимо.

---

## Phase 5: User Story 3 - Понять неполноту и ограничения анализа (Priority: P3)

**Goal**: неразрешённые ссылки, пустые состояния, ошибки, лимиты и большие
графы показаны честно и с понятным выходом.

**Independent Test**: Demo ZIP с внешним namespace и отсутствующим
`ProjectReference` даёт список из 2 ссылок и не даёт фиктивных рёбер.

- [x] T028 [US3] Добавить список неразрешённых ссылок, счётчик и фильтр в `project/src/ui/GraphList.tsx`
- [x] T029 [US3] Реализовать состояния `empty`/`error`/`limit`, «Повторить» и защиту от устаревших результатов в `project/src/ui/GraphTab.tsx`
- [x] T030 [US3] Реализовать пороги отображения (200/500, 1000/3000), переключатель «Список»/«Граф», детерминированное упрощение до 200 узлов с наибольшей суммарной степенью (входящие + исходящие) и 500 связей, оба конца которых попали в выбранные узлы, с наибольшей суммой степеней концов, и режим «только список» в `project/src/ui/GraphTab.tsx`, `project/src/ui/GraphList.tsx`, `project/src/ui/GraphView.tsx`
- [x] T031 [US3] Показывать предупреждения и счётчики исключённых файлов в `project/src/ui/GraphTab.tsx` и `project/src/ui/GraphList.tsx`
- [x] T032 [US3] Добавить `aria-live` для состояний, `prefers-reduced-motion`, порядок фокуса и нецветовые подписи (пунктир + текст «условная») в `project/src/ui/GraphTab.tsx` и `project/src/styles.css`
- [x] T033 [US3] Пройти Playwright-сценарии 3–7 из `quickstart.md`: unresolved, регистр/static/alias, пусто, лимит (`LIMIT_NODES` на ZIP с 3001 `PackageReference`) и большой граф, клавиатура, 375 px; проверить, что HTML-подобное имя файла выводится текстом
- [x] T034 [US3] Запустить `npm run check` в `project/` после изменений US3

**Checkpoint**: все три истории работают, ограничения видны пользователю.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: документация, доказательства проверок и демо.

- [x] T035 [P] Обновить `project/README.md`: вкладка «Граф», лимиты, запуск
- [x] T036 [P] Записать команды и результаты проверок в `specs/001-csharp-dependency-graph/checks.md`
- [x] T037 [P] Сделать скриншоты графа, пустого состояния, лимита и экрана 375 px в `specs/001-csharp-dependency-graph/demo/`
- [x] T038 Написать `specs/001-csharp-dependency-graph/reflection.md`: что согласовали, что изменилось после контракта, что бы улучшили
- [x] T039 Пройти `quickstart.md` целиком и запустить финальный `npm run check` в `project/`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: без зависимостей.
- **Foundational (Phase 2)**: после Setup; блокирует все истории.
- **US1 (Phase 3)**: после Foundational; даёт MVP.
- **US2 (Phase 4)**: после US1 (нужны `GraphTab` и `GraphView`).
- **US3 (Phase 5)**: после US1; использует список и состояния из US1.
- **Polish (Phase 6)**: после US1–US3.

### User Story Dependencies

- **US1 (P1)**: самостоятельна после Foundational.
- **US2 (P2)**: добавляет детали и переход в таблицу к US1.
- **US3 (P3)**: добавляет честные ограничения к US1; от US2 не зависит.

### Within Each User Story

- Сначала падающие тесты (T011, T012), затем реализация.
- Модель/типы → сборка → UI → проверка.
- US2: детали → выбор → переход в таблицу → клавиатура → адаптивность.
- US3: unresolved → состояния → большие графы → предупреждения → доступность.

### Parallel Opportunities

- T003–T004 — разные файлы; T002 выполняется после T003.
- T005–T009 — разные файлы (после T003/T004).
- T011/T012 — разные тестовые файлы.
- T014 и T017 — разные файлы, не зависят от T013.
- T022 и T028 — разные компоненты, после US1.

---

## Parallel Example: User Story 1

```text
T011: тесты сборки графа в project/test/graph-builder.test.ts
T012: тесты лимитов в project/test/graph-limits.test.ts
T014: раскладка в project/src/lib/graph/layout.ts
T017: список в project/src/ui/GraphList.tsx
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1: Setup.
2. Phase 2: Foundational.
3. Phase 3: US1.
4. **STOP and VALIDATE**: сценарий 1 из `quickstart.md`, `npm run check`.
5. Показать демо графа.

### Incremental Delivery

1. US1 → граф и таблица работают.
2. US2 → детали и переход к файлу.
3. US3 → честные ограничения и большие графы.
4. Polish → checks, demo, reflection.

---

## Notes

- [P] — разные файлы, нет зависимости от незавершённых задач.
- Тесты логики обязательны по конституции; UI проверяется Playwright.
- Не менять `analyzeZipFile`, `AnalysisResult`, `LIMITS` и существующие тесты.
- Не читать `.env`, ключи, сертификаты; не выполнять C#-код.
- После каждой истории — `npm run check` и фиксация результата.
