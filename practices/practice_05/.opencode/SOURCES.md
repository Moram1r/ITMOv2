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

- [Context7](https://github.com/upstash/context7): официальный удалённый endpoint
  `https://mcp.context7.com/mcp`; режим без API-ключа с ограничениями сервиса.
  Версия удалённого сервиса управляется его владельцем.
  Из-за тайм-аутов прямого доступа WSL подключён через локальный stdio-переходник
  на MCP SDK и Windows curl.exe с уже существующим прокси `127.0.0.1:10809`.
  Инструменты и документация приходят от официального сервера; переходник меняет
  только транспорт. Значение прокси задаётся в локальном opencode.json.
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
