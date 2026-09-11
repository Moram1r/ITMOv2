# Integration-проверки

| Связь компонентов | Что может сломаться | Как воспроизводим | Ожидаемый результат | Evidence |
|---|---|---|---|---|
| HTTP API -> ReviewService -> LLM | Нарушение формата OUT-1 | POST /api/reviews с валидным diff; mock LLM возвращает корректный текст | HTTP 200; JSON со структурой OUT-1; risks<=3 | CASE.md OUT-1; TRAINING_PR.diff: app/api.py:35-37; app/review_service.py:19-22 |
| HTTP API -> ReviewService | Oversize diff | POST /api/reviews с diff длиной 20001 | HTTP 413 без вызова LLM | CASE.md API-1; OBS-1: в логах только request_id/длительность/статус |
| ReviewService -> LLM | Таймаут внешнего вызова | POST с валидным diff; mock LLM спит >10с | HTTP 200; контролируемый OUT-1 с пустыми risks/checks и summary о деградации | CASE.md REL-1/OUT-1 |

## Как использовали AI

- Строка в [`prompts.md`](prompts.md): P1-02.
- Что проверили и исправили сами: Соотносимость с другими артефактами проекта

