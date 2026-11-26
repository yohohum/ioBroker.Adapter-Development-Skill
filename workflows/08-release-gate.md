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

- **E6012 (Error)** — проверка пользовательской README-инструкции установки через прямой npm-путь. В `@iobroker/repochecker@5.24.3` условие — README содержит строку вида `npm install iobroker.<name>`, `npm i iobroker.<name>` либо `cd /opt/iobroker`; checker не запрещает любую npm-команду. Удали именно инструкции установки адаптера таким способом. README — пользовательская документация; описывай штатную установку через ioBroker Admin/официальный механизм.
- **E6013 (Error)** — отдельное условие: README рекомендует прямую установку с GitHub/внешнего URL, `iobroker url`/`iob url` с GitHub URL, npm GitHub shorthand, собственный URL (`install from own url`) или установку ZIP через Admin. Удали такие пользовательские способы и оставь штатную установку через Admin. Не объединяй E6013 с E6012: pattern conditions у них различаются. Команды разработчика для install/test/build не удаляй автоматически: помести их в специализированную developer documentation (например, `DEVELOPMENT.md`), не предлагая эти команды пользователям как способ установки адаптера.
- **W5042 (Warning)** — проверяет `import`/`require` внешнего пакета в сканируемом source-файле и предупреждает, если пакет не указан в `dependencies`. Это статическое сопоставление usage с package metadata, а не определение реальной среды исполнения. Scope зависит от версии checker: подтверждённый `@iobroker/repochecker@5.24.3` сканирует `.js`, `.mjs`, `.cjs`, `.ts`, исключая каталоги `admin/` (в том числе `admin/src`), `test/` (test files), `scripts/`, `build/`, `doc/`, `docs/`, `src-admin/`, `admin-src/`, а также `*.test.*` и `*.config.*`. Другие версии и scanners могут анализировать тесты, `admin/src`, UI, build и development files; такие imports способны вызвать warning, хотя пакет нужен только вне production runtime. `dependencies` предназначены для пакетов, требуемых опубликованному адаптеру при эксплуатации; `devDependencies` — для тестов, UI compilation, build и разработки (если продуктовая сборка действительно включает UI dependency, оценивай её установленную среду исполнения по факту). Примеры потенциально test/UI/build-only: `@playwright/test`, `react`, `@mui/*` — по usage, не по названию.
- **Обязательный алгоритм W5042:** (1) определить package/import из warning; (2) найти все места использования; (3) классифицировать каждое как runtime, Admin UI, test, build или development; (4) установить, нужен ли пакет именно production runtime установленного адаптера; (5) если нужен runtime — проверить `dependencies`; (6) если нужен только test/build/development — проверить `devDependencies`; (7) не переносить механически все найденные пакеты в `dependencies`; (8) проверить false positive и scanner scope/version; (9) при сомнении изучить исходник checker или воспроизвести его проверку; (10) исправить metadata согласно реальному usage; (11) проверить runtime, Admin UI, tests и сборку, чтобы исправление ничего не сломало.
- **S5043** — рекомендация использовать префикс `node:` для встроенных модулей Node.js (например, `node:fs`, `node:path` вместо `fs`, `path`). Это suggestion, не error, но рекомендуется к соблюдению.
- **S5004 / S5005** — таймеры адаптера. Используй `adapter.setInterval()` и `adapter.setTimeout()` вместо обычных `setInterval`/`setTimeout`, чтобы контроллер мог корректно очистить таймеры при остановке адаптера.
- **W5004 / W5005** — корректная очистка таймеров. Всегда вызывай `clearInterval()`/`clearTimeout()` в обработчике `unload`/`stop`. Обрабатывай асинхронные операции в циклах опроса, предотвращай наложение параллельных запросов.
- **common.news / W2004 (Warning)** — в опубликованном `@iobroker/repochecker@5.24.3` версия, указанная в `common.news`, но отсутствующая в npm registry, выдаёт **W2004 Warning** и будет проигнорирована при формировании repository listing. Правильный порядок: подготовить версию и выполнить обязательные release validation; опубликовать пакет; проверить `npm view <package>@<version> version`; затем добавить/обновить `common.news` согласно требованиям проекта и повторно запустить repochecker с опубликованной версией. Не добавляй будущую версию до публикации.
- **E2004 — требование куратора и upstream-конфликт:** запрошенное описание «Error, если common.news version не опубликована в npm» противоречит опубликованному `@iobroker/repochecker@5.24.3`: в `doc/issues.json` E2004 отсутствует, а это условие реализовано как **W2004 Warning** в `lib/M2000_Npm.js`. Не приписывай checker неподтверждённое E2004 и не понижай severity существующего правила. Перед сменой документации сверяй точный source конкретной используемой версии. Для подтверждённого 5.24.3 порядок исправлен ниже: опубликовать, проверить registry, затем включить версию в `common.news`.
- **License** — раздел `## License` должен быть последним основным разделом `README.md` (не в `io-package.json`). Проверь наличие файла LICENSE, актуальность года copyright, указание автора и согласованность с полем `license` в `package.json`/`io-package.json`.
- **CHANGELOG и CHANGELOG_OLD** — актуальная схема хранит changelog в `README.md`: release-script превращает `WORK IN PROGRESS` в версионный заголовок и оставляет WIP для последующих изменений. Не переносить текущий WIP вручную в `CHANGELOG_OLD.md` при обычном релизе. Архивируй только старые версии сверх последних пяти согласно S6020; сохраняй последние пять в README. Отдельный файл `CHANGELOG.md` не требуется.
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
