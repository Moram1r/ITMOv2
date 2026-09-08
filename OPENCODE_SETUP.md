# OpenCode: установка и подключение модели

OpenCode нужен как единый терминальный интерфейс к LLM. На Практике 1 он работает в режиме анализа: читает приложенный diff, но не меняет файлы и не запускает команды.

Официальная документация: <https://opencode.ai/docs>.

## 0. Свой форк

1. Откройте студенческий репозиторий и нажмите **Fork**.
2. Клонируйте форк из своего GitHub-аккаунта:

   ```bash
   git clone https://github.com/<ваш-логин>/ITMOv2.git
   cd ITMOv2
   git remote -v
   ```

3. В `origin` должен быть ваш GitHub-логин. Все изменения и PR делаются из этого форка.

## 1. Установка

Выберите один способ.

macOS или Linux:

```bash
curl -fsSL https://opencode.ai/install | bash
```

Если уже установлен Node.js:

```bash
npm install -g opencode-ai
```

macOS через Homebrew:

```bash
brew install anomalyco/tap/opencode
```

Windows: используйте WSL, затем выполните команду для Linux.

Проверка:

```bash
opencode --version
```

## 2. Подключение VseLLM

1. Получите у преподавателя учебный VseLLM API key. Не пересылайте его другим студентам и не публикуйте.
2. Создайте локальный конфиг OpenCode `opencode.json` в корне репозитория. Не добавляйте этот файл в commit, если в нём указан ключ напрямую. Рекомендуемый вариант — передать ключ через переменную окружения:

   ```json
   {
     "$schema": "https://opencode.ai/config.json",
     "provider": {
       "vsellm": {
         "npm": "@ai-sdk/openai-compatible",
         "name": "VseLLM",
         "options": {
            "baseURL": "https://litellm.data-light.ru",
            "apiKey": "{env:VSELLM_API_KEY}"
         },
         "models": {
           "openai/gpt-5": {
             "name": "openai/gpt-5"
           },
           "anthropic/claude-sonnet-4": {
             "name": "anthropic/claude-sonnet-4"
           }
         }
       }
     }
   }
   ```

3. В текущем терминале задайте ключ:

   ```bash
   export VSELLM_API_KEY='ваш-ключ-vsellm'
   ```

   Запустите OpenCode:

   ```bash
   opencode
   ```

4. Если OpenCode предложит подключить провайдера через `/connect`, выберите `VseLLM` и вставьте API key. Затем выполните `/models` и выберите модель, указанную преподавателем.

Проверка сохранённого провайдера:

```bash
opencode auth list
```

OpenCode хранит credential вне репозитория, в пользовательском файле `~/.local/share/opencode/auth.json`. Не копируйте этот файл и не добавляйте API key в `.env`, Markdown, скриншоты, commit или PR. Добавьте локальный `opencode.json` в `.git/info/exclude`.

## 3. Быстрая проверка

```bash
opencode run "Ответь одним словом: READY"
```

Если модель не выбрана, вернитесь в TUI, выполните `/models` и выберите доступную модель VseLLM.

## 4. Запуск для Практики 1

Из корня репозитория:

```bash
opencode run \
  --agent plan \
  --file practices/practice_01/TRAINING_PR.diff \
  -- \
  "Используй только приложенный diff. Не читай другие файлы репозитория. Посмотри PR и найди проблемы."
```

Для второго запуска приложите тот же diff и передайте `Master Prompt v1` из `practices/practice_01/prompts.md`. Context Pack из `context.md`, `CASE.md` и связанных артефактов должен быть встроен в этот master prompt.

Важно:

- не используйте `--auto`;
- не переключайтесь в Build для этой практики;
- не разрешайте изменение файлов и выполнение shell-команд;
- используйте одну и ту же модель в обоих запусках;
- не запускайте OpenCode из приватного рабочего репозитория с реальными секретами.

## 5. Если что-то не работает

- `opencode: command not found` — перезапустите терминал и повторите `opencode --version`;
- провайдер не виден — проверьте `opencode.json`, переменную `VSELLM_API_KEY`, затем повторите `/connect`;
- модель недоступна — откройте `/models` и выберите доступную преподавателю и группе;
- OpenCode просит разрешение на запись или shell — отклоните: в Практике 1 эти действия не нужны;
- токен случайно попал в файл или PR — немедленно удалите его из публикации и отзовите ключ в VseLLM.
