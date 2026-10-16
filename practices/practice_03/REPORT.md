# REPORT

## Hardware
- CPU: AMD Ryzen AI 7 350 w/ Radeon 860m
- dGPU: NVIDIA GeForce RTX 5060 Laptop (8 GB VRAM)
- RAM: 16 GB DDR5
- OS: WSL2 (Windows Subsystem for Linux)

## Software
- Python: 3.14.4
- Ollama: 0.34.4 (WSL)
- Kernel (WSL2): 6.18.33.2-microsoft-standard-WSL2

## Models
- Base: qwen3.5:4b (ID: 2a654d98e6fb)
- itmo:latest (ID: 721e96699aea)
- itmo-agent:latest (ID: 3465bc38f59d)
- Format: base (без instruct)

## Configuration
- Context length:
  - itmo: 4096 (Modelfile)
  - itmo-agent: 65536 (Modelfile.agent; 1 поток)
- Temperature: 0.2
- OpenCode provider (demo): Ollama local, baseURL: http://localhost:11434/v1
- opencode.json (demo) limits: context 8192, output 4096

## Rationale
- Выбор семейства: Qwen 3.5 4B — лёгкая модель, надёжно работает на RTX 5060 8 GB VRAM в одном потоке.
- Формат base: минимизирует склонность к структурированным шаблонам, ответы ближе к “обычному тексту”.
- Контекст: дефолт 4k (itmo), для агента увеличен (itmo-agent) осознанно для экспериментов в Build; в read-only сессиях используем лимит 8k из opencode.json, чтобы избегать компактации.

## Questions (ethalons and model answers)

Эталоны (по коду demo/):
1. Как запустить тесты? — make test. Источники: demo/Makefile:2-3; demo/README.md:6.
2. Пустое имя подписчика? — ValueError("empty name"). Источники: demo/service.py:5-6; demo/test_service.py:13-15.
3. Где реализован unsubscribe? — В предоставленных материалах нет ответа; такой функции нет.
4. Какая CI-система запускает тесты? — В предоставленных материалах нет ответа.
5. Сохраняются ли подписки после перезапуска? — Нет, в памяти процесса. Источники: demo/README.md:2; demo/service.py:1.

Ответы модели (локальные сессии, через Ollama API):
1. Запустить тесты командой `make test`. Основание: demo/README.md: «Проверка: make test»; demo/Makefile: цель test → `python3 -m unittest -v`.
2. При пустом имени — исключение `ValueError`. Основание: demo/service.py: `if not name.strip(): raise ValueError("empty name")`; подтверждение в demo/test_service.py:test_empty.
3. «В предоставленных материалах нет ответа». Основание: unsubscribe отсутствует в service.py/README.md/Makefile/test_service.py.
4. «В предоставленных материалах нет ответа». Основание: в README/Makefile указана только локальная команда `make test`, CI не указан.
5. «Подписки не сохраняются». Основание: README.md: «Подписчики хранятся в памяти процесса».

Сравнение с эталонами: совпадение по всем 5 пунктам.

## Test Run
- make -C practices/practice_03 test → OK (3 теста пройдены)

## Notes / Limitations
- 8 GB VRAM, 1 поток. Для длинных Build-сценариев возможна компактация контекста в OpenCode; для чистых ответов использовать read-only сессии (агент local-guide).
- NPU в WSL не задействуется; ускорение — на NVIDIA (CUDA) или CPU.
