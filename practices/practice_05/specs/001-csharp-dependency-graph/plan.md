# Implementation Plan: Граф зависимостей C#-проекта

**Branch**: `001-csharp-dependency-graph` | **Date**: 2026-10-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-csharp-dependency-graph/spec.md`

## Summary

Добавить в существующее браузерное приложение вкладку «Граф», которая по ZIP
с C#-проектом строит статический граф зависимостей. Анализ выполняется лениво
при первом открытии вкладки: читаются только `.cs` и `.csproj`, разбираются
`ProjectReference`, `PackageReference`, `using` и объявления `namespace`.
Неразрешённые ссылки не дорисовываются, а показываются отдельным списком.
Граф отображается через React Flow, для больших графов первым открывается
полный список. Существующие анализ ZIP, сводка, таблица и лимиты не меняются.

## Technical Context

**Language/Version**: TypeScript 5.6, React 18.3, Vite 5.4

**Primary Dependencies**: `@zip.js/zip.js` 2.7 (уже есть), React 18 (уже есть),
`@xyflow/react` 12.12 (новая, MIT)

**Storage**: нет; всё в памяти вкладки, без сохранения между сессиями

**Testing**: Vitest 2.1 (node), ZIP-фикстуры генерируются в тестах;
интерфейс проверяется через Playwright MCP

**Target Platform**: современные браузеры (desktop и mobile), без сервера

**Project Type**: одностраничное веб-приложение

**Performance Goals**: на машине проверки разбор до 20 МиБ текста ≤ 5 с;
реакции интерфейса (вкладки, сброс) ≤ 1 с; интерактивный граф до 1000 узлов /
3000 рёбер; выше — список без графа

**Constraints**: только браузер; нет сети, выполнения C#-кода, Roslyn и сервера;
ZIP ≤ 20 МиБ, ≤ 2000 записей, ≤ 100 МиБ распакованного объёма

**Scale/Scope**: до 3000 узлов и 10 000 рёбер в результате; одна новая вкладка

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Принцип | Статус | Как выполняется |
| --- | --- | --- |
| I. Браузер — граница доверия | PASS | ZIP читается через `zip.js` локально; сетевых вызовов нет |
| II. Архив — данные, а не код | PASS | нет `eval`/`new Function`, C# не компилируется; содержимое `.env`, ключей и сертификатов не читается; в таблице остаются только путь, расширение и размер как факт наличия |
| III. Ограниченный анализ | PASS | лимиты файла, текста, узлов и рёбер; граф содержит только прямые связи (глубина 1), рекурсивного обхода нет; понятные ошибки; тесты на границы |
| IV. Честный граф | PASS | только точные совпадения namespace и нормализованных путей; неразрешённое — отдельный список |
| V. Простота | PASS | одна новая зависимость (React Flow) с обоснованием; без state-библиотек и layout-движка |
| VI. Сначала контракт | PASS | `contract.md` подтверждён, спеки «до/после» и `spec.md` созданы до кода |
| VII. Проверяемость | PASS | unit-тесты логики, Playwright-сценарии, `npm run check` |

Нарушений нет; Complexity Tracking не заполняется.

**Post-design re-check**: архитектура ниже не добавляет серверных вызовов,
не выполняет загруженный код и сохраняет все лимиты — все принципы по-прежнему
выполняются.

## Project Structure

### Documentation (this feature)

```text
specs/001-csharp-dependency-graph/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── graph-api.md
├── checklists/requirements.md
├── spec-ui-before.md
├── spec-logic-before.md
├── contract.md
├── spec-ui-after.md
├── spec-logic-after.md
├── checks.md
├── demo/
├── reflection.md
└── tasks.md              # создаётся /speckit.tasks
```

### Source Code (repository root)

```text
project/
├── src/
│   ├── lib/
│   │   ├── limits.ts              # + GRAPH_LIMITS, GRAPH_DISPLAY_LIMITS
│   │   ├── zip-analyzer.ts        # без изменений
│   │   └── graph/
│   │       ├── types.ts           # публичные типы графа
│   │       ├── paths.ts           # нормализация, ext, obj/bin, ближайший проект
│   │       ├── zip-source.ts      # чтение .cs/.csproj из ZIP с лимитами
│   │       ├── cs-parser.ts       # using/namespace без выполнения кода
│   │       ├── csproj-parser.ts   # ProjectReference/PackageReference
│   │       ├── build-graph.ts     # сборка, разрешение, stats, ошибки
│   │       ├── layout.ts          # детерминированная раскладка
│   │       └── index.ts           # публичные экспорты
│   ├── ui/
│   │   ├── App.tsx                # вкладки, подсветка строки, сброс
│   │   ├── GraphTab.tsx           # ленивый запуск, состояния, токен
│   │   ├── GraphView.tsx          # React Flow, zoom/pan, выбор
│   │   ├── GraphList.tsx          # полный список, fallback
│   │   └── GraphDetails.tsx       # детали узла/ребра/ссылки
│   └── styles.css                 # вкладки, граф, список, детали
├── test/
│   ├── analyzer.test.ts           # без изменений
│   ├── graph-fixtures.ts          # генерация ZIP для тестов
│   ├── graph-parser.test.ts
│   ├── graph-builder.test.ts
│   └── graph-limits.test.ts
```

**Structure Decision**: используется существующая структура одного проекта.
Логика графа изолирована в `src/lib/graph/` и не зависит от DOM; UI — отдельные
компоненты в `src/ui/`. Тесты — рядом с существующими в `test/`.

## Implementation Approach

1. **Типы, лимиты, пути.** Добавить `types.ts`, `GRAPH_LIMITS` и
   `GRAPH_DISPLAY_LIMITS`; нормализацию путей, определение `obj/`/`bin/`,
   ближайшего `.csproj` и `tablePath`.
2. **Чтение ZIP.** `zip-source.ts` переоткрывает архив, отбирает только
   `.cs`/`.csproj`, проверяет размер файла, декодирует через `TextWriter`,
   считает суммарный текст и собирает `excluded`.
3. **Парсеры.** `cs-parser.ts` снимает комментарии и литералы, извлекает
   `using`/`using static`/alias/`namespace`; `csproj-parser.ts` сканирует теги
   с учётом вложенности и `Condition`, объединяя вложенные условия через
   ` && `, и игнорирует XML-комментарии. Оба парсера — чистые функции без DOM.
4. **Сборка графа.** `build-graph.ts` создаёт узлы, разрешает ссылки с учётом
   регистра namespace, дедуплицирует рёбра, формирует `unresolved`, статусы,
   `stats`, сортирует и проверяет жёсткие лимиты.
5. **UI.** `App.tsx` получает вкладки, сохранение смонтированной панели графа
   и подсветку строки; `GraphTab.tsx` — ленивый запуск, состояния, переключатель
   «Список»/«Граф» и защита от устаревших результатов; `GraphView`, `GraphList`,
   `GraphDetails` — отображение.
6. **Проверки.** Unit-тесты парсеров, сборки, лимитов и детерминизма; затем
   `npm run check` и Playwright-сценарии из `quickstart.md`.

## Dependency Justification

| Зависимость | Зачем | Почему не проще |
| --- | --- | --- |
| `@xyflow/react` 12.12 (MIT) | pan/zoom, рёбра, выбор узлов, доступность из коробки | собственный SVG-движок потребует больше кода и даст худшую производительность и клавиатурную поддержку |

Новых state-библиотек, layout-движков и парсеров C# не добавляется.

## Risks & Mitigations

| Риск | Смягчение |
| --- | --- |
| Regex-парсинг C# ошибается на сложном синтаксисе | снятие комментариев и литералов, точное совпадение namespace с учётом регистра, тесты, честные `unresolved`/`warnings` |
| `.csproj` с нестандартным XML | сканер тегов с вложенностью и `Condition`; при ошибке — предупреждение, проект остаётся узлом |
| Большой граф тормозит браузер | лимиты анализа и пороги отображения; выше 1000/3000 — только список |
| React Flow увеличивает бандл | ленивая загрузка вкладки через `React.lazy`, отдельный chunk |
| Устаревший результат после выбора нового архива | токен запроса в `GraphTab`, результат с другим токеном игнорируется |
| Циклы ломают раскладку | детерминированный BFS по компонентам с обходом циклов; циклы не считаются ошибкой |
