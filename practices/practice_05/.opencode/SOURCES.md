# Происхождение навыков

Локальные SKILL.md — сокращённые русскоязычные адаптации, а не дословные копии.
Дата подбора: 2026-10-22. Исходники прочитаны перед адаптацией; внешние скрипты
не устанавливались и не запускались.

| Навык | Зафиксированный источник | Лицензия рядом с навыком |
| --- | --- | --- |
| frontend-design | [anthropics/skills](https://github.com/anthropics/skills/tree/dbd4588f9e1033efb41dad4bef2f7947c8993d44/skills/frontend-design) | Исходная LICENSE.txt (Apache-2.0) |
| test-driven-development | [obra/superpowers](https://github.com/obra/superpowers/tree/2ce8aa15d05bd57213e6f746f953aafb7ded7a8b/skills/test-driven-development) | Исходная MIT |
| systematic-debugging | [obra/superpowers](https://github.com/obra/superpowers/tree/2ce8aa15d05bd57213e6f746f953aafb7ded7a8b/skills/systematic-debugging) | Исходная MIT |

Изменения: перевод и сокращение; привязка к анализу ZIP и местным командам;
удаление зависимостей от других навыков Superpowers; прямые проверки вместо
обязательных тестов для документации и конфигурации. Навыки самостоятельные,
вызов сторонних агентов для них не требуется.

## MCP и конфигурация

- [Microsoft Playwright MCP](https://github.com/microsoft/playwright-mcp):
  `@playwright/mcp` 0.0.83; Node-зависимости закреплены package-lock.json.
  Браузер устанавливается отдельно в игнорируемый локальный кэш.
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk):
  1.32.1, используется только для проверки MCP без обращения к модели.
- [Навыки OpenCode](https://opencode.ai/v2/docs/skills/),
  [MCP OpenCode](https://opencode.ai/v2/docs/mcp-servers/).
  Настройки и локальный хук проверяются на установленном OpenCode 2.0.30;
  формат V2 дополнительно сверен с его `/openapi.json` и публичным интерфейсом
  пакета `@opencode/plugin` (Promise API).

## Spec Kit

- [GitHub Spec Kit v1.2.3](https://github.com/github/spec-kit/tree/v1.2.3),
  официальный пакет [specify-cli на PyPI](https://pypi.org/project/specify-cli/1.2.3/).
  Лицензия MIT сохранена в `.specify/LICENSE`.
- Инициализация: `specify init --here --force --non-interactive --integration opencode
  --script sh --integration-options="--events false"`. Перед установкой проверена
  в отдельном временном каталоге. Шаблоны и команды сгенерированы штатным CLI;
  их содержимое вручную не переписывалось.
- Локальные дополнения: `.opencode/bin/specify` и плагин `spec-kit-env.js`
  обеспечивают PATH и `SPECIFY_INIT_DIR` для работы внутри одной практики.
- [Интеграция OpenCode](https://github.github.io/spec-kit/integrations/opencode.html),
  [установка](https://github.github.io/spec-kit/installation.html).
