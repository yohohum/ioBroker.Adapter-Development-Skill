# Этап 8. Предрелизная проверка и приёмка

## 1. Автоматический локальный gate

Из корня адаптера после checkout и установки зависимостей:

```bash
npm ci
bash /path/to/skill/scripts/run-adapter-checks.sh .
```

Скрипт выполняет `build`, `lint`, `test:package`, `test:integration`, preflight и repochecker. Не пропускай ошибку. Если названия npm scripts отличаются, обнови scripts проекта и/или аргументированно адаптируй gate.

## 2. Repochecker

Запусти из корня адаптера с указанием локального пути или URL репозитория:

```bash
npx --yes @iobroker/repochecker --local .
```

Или для проверки公開ного репозитория по URL:

```bash
npx --yes @iobroker/repochecker https://github.com/<OWNER>/ioBroker.<adaptername>
```

Смотри полный output, устрани все блокирующие и значимые сообщения. При несовпадении с текущей документацией проверь changelog repochecker и schema; не подавляй правило локально.

Обрати особое внимание на распространённые коды repochecker для новых адаптеров:

- **E6012 / E6013** — инструкции по установке в README (раздел установки, npm/iBroker commands).
- **W5042 / S5043** — префикс `node:` для встроенных модулей Node.js (например, `node:fs`, `node:path`).
- **S5004 / S5005** — таймеры адаптера (корректное создание/очистка интервалов и таймаутов).
- **Ограничение news** — не более 7 записей в разделе news `io-package.json`.
- **E2004** — версии, упомянутые в news, должны существовать в npm registry.
- **License** — раздел лицензии должен быть последним в `io-package.json`; год в копирайте должен быть актуальным; файл `CHANGELOG_OLD` не должен конфликтовать с `CHANGELOG.md`.
- **RE-CHECK!** — используй формат `RE-CHECK!` (с восклицательным знаком) в коммитах для повторной проверки репочекером, а не `recheck`.
- **Лимит GitHub API** — у репочекера есть лимит запросов к GitHub API; при массовых проверках делай паузы.

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
3. Запусти `npx --yes @iobroker/repochecker --local .` и устрани все ошибки.
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
