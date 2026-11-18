# Этап 8. Предрелизная проверка и приёмка

## 1. Автоматический локальный gate

Из корня адаптера после checkout и установки зависимостей:

```bash
npm ci
bash /path/to/skill/scripts/run-adapter-checks.sh https://github.com/<OWNER>/ioBroker.<adaptername>
```

Скрипт выполняет `build`, `lint`, `test:package`, `test:integration`, preflight, проверку переводов и repochecker. Не пропускай ошибку. Если названия npm scripts отличаются, обнови scripts проекта и/или аргументированно адаптируй gate.

## 2. Repochecker

Запусти с указанием URL GitHub-репозитория адаптера:

```bash
npx --yes @iobroker/repochecker@latest https://github.com/<OWNER>/ioBroker.<adaptername>
```

Для дополнительной локальной предварительной проверки с URL и env-файлом:

```bash
npx --yes @iobroker/repochecker@latest https://github.com/<OWNER>/ioBroker.<adaptername> --local --env .repochecker.env
```

Не используй `--local` с пустым или локальным путём вместо URL. Local mode не заменяет удалённый запуск и проверку в ioBroker.repositories.

Смотри полный output, устрани все блокирующие и значимые сообщения. При несовпадении с текущей документацией проверь changelog repochecker и schema; не подавляй правило локально.

Обрати особое внимание на распространённые коды repochecker для новых адаптеров:

- **E6012 / E6013** — отсутствие или некорректность инструкций по установке адаптера в README. Запрещены: прямая установка через `npm install <github-url>`, установка ZIP-архивом, любые инструкции обхода штатного процесса установки через npm/iBroker Admin. Обычное описание установки через интерфейс Admin (создание экземпляра адаптера) допустимо.
- **W5042** — отсутствие runtime-зависимости в `dependencies` (модуль импортируется в коде, но не указан в `dependencies` package.json).
- **S5043** — рекомендация использовать префикс `node:` для встроенных модулей Node.js (например, `node:fs`, `node:path` вместо `fs`, `path`). Это suggestion, не error, но рекомендуется к соблюдению.
- **S5004 / S5005** — таймеры адаптера. Используй `adapter.setInterval()` и `adapter.setTimeout()` вместо обычных `setInterval`/`setTimeout`, чтобы контроллер мог корректно очистить таймеры при остановке адаптера.
- **W5004 / W5005** — корректная очистка таймеров. Всегда вызывай `clearInterval()`/`clearTimeout()` в обработчике `unload`/`stop`. Обрабатывай асинхронные операции в циклах опроса, предотвращай наложение параллельных запросов.
- **common.news** — не более 7 записей в разделе `common.news` `io-package.json`. Каждая запись — локализованный объект с ключом версии (например, `"1.0.0": { "en": "...", "de": "..." }`). Убедись, что версии в news существуют в npm registry.
- **W2004** — правило о том, что версии в news должны существовать в npm registry (статус Warning, не Error). Тем не менее, следите за актуальностью версий в news.
- **License** — раздел `## License` должен быть последним основным разделом `README.md` (не в `io-package.json`). Проверь наличие файла LICENSE, актуальность года copyright, указание автора и согласованность с полем `license` в `package.json`/`io-package.json`.
- **CHANGELOG и CHANGELOG_OLD** — актуальная схема хранит changelog в разделе `WORK IN PROGRESS` `README.md`. Старые записи архивируются в `CHANGELOG_OLD.md`. Отдельный файл `CHANGELOG.md` не требуется и может быть удалён.
- **RE-CHECK!** — отправляется отдельным комментарием в Pull Request в `ioBroker.repositories`, а не в Git-коммите. Последовательность: 1) внести исправления; 2) отправить коммиты; 3) оставить комментарий `RE-CHECK!` в PR; 4) дождаться повторного workflow; 5) проверить итоговый результат.
- **GitHub API rate limit** — у repochecker есть лимит запросов к GitHub API. Используй `--env .repochecker.env` с переменной `GITHUB_TOKEN` для аутентификации. Пример `.repochecker.env`:
  ```
  GITHUB_TOKEN=ghp_...
  ```
  Добавь `.repochecker.env` в `.gitignore`. Не допускай попадания токена в Git, логи и отчёты.

Не игнорируй severity и не меняй код ради отключения проверки.

## 3. Object dump

Следуй официальному [OBJECTDUMP.md](https://github.com/ioBroker/ioBroker.repochecker/blob/master/OBJECTDUMP.md). Создай dump из реально запущенного адаптера, проверь его в редакторе и не публикуй secret/private user data.

Вспомогательная проверка:

```bash
node /path/to/skill/scripts/check-object-dump.mjs ./OBJECTDUMP.json
```

Скрипт принимает JSON array объектов или object map `{id: object}`. Он проверяет базовые свойства и роли indicator/button; это не официальный schema validator.

## 4. Online Adapter Checker

Открой [adapter-check.iobroker.in](https://adapter-check.iobroker.in/), укажи публичный GitHub URL. Сохрани дату, URL, результат и список исправлений. Не заявляй об успешной онлайн-проверке без фактического результата.

## 5. npm tarball

```bash
npm pack --dry-run
```

Просмотри список файлов. Убедись, что пакет содержит runtime build, `io-package.json`, `admin/` и необходимые license/readme/resource файлы, но не содержит `node_modules`, `.dev-server`, тестовые секреты, логи и не предназначенные к публикации исходники.

Проверяй фактическое поле `files`, `.npmignore` и результат `npm pack`, а не предполагай что файлы автоматически попадут в пакет.

## 6. Ручной smoke test

На поддерживаемой системе/устройстве проверь установку npm пакета или локального tarball, создание экземпляра, connect, read/write, reconnect, update и uninstall/cleanup.

## 7. Обязательный прогон перед добавлением в репозиторий

Перед созданием PR в `ioBroker.repositories` или добавлением адаптера в latest/stable выполни полный прогон проверки на актуальность:

1. Убедись, что все зависимости обновлены до актуальных совместимых версий.
2. Запусти `npm ci`, `npm run build`, `npm run lint`, `npm run test:package`, `npm run test:integration`.
3. Запусти `npx --yes @iobroker/repochecker@latest https://github.com/<OWNER>/ioBroker.<adaptername>` и устрани все ошибки.
4. Запусти онлайн-проверку [adapter-check.iobroker.in](https://adapter-check.iobroker.in/) и обработан все замечания.
5. Убедись, что `io-package.json` и `package.json` версии синхронизированы.
6. Убедись, что README на английском содержит инструкции по установке, описание устройства/производителя и changelog.

## 8. Критерии допуска

- [ ] Build/lint/package/integration прошли.
- [ ] Repochecker прошёл или все оставшиеся warnings приняты с объяснением.
- [ ] Object dump создан по официальному процессу и проверен.
- [ ] Online Adapter Checker запущен и замечания обработаны.
- [ ] npm pack содержит только ожидаемые файлы.
- [ ] README на английском заполнен, есть ссылка на устройство/производителя и changelog.
- [ ] `io-package.json` содержит корректные типы, roles, authors, titles и конфигурационный диалог Admin (jsonConfig).
- [ ] npm package доступен/готов к публикации и `iobroker` organisation owner добавлена согласно правилам repositories.
- [ ] Непроверенные hardware сценарии обозначены.
