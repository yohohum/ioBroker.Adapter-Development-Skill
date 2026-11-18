# Этап 8. Предрелизная проверка и приёмка

## 1. Автоматический локальный gate

Из корня адаптера после checkout и установки зависимостей:

```bash
npm ci
bash /path/to/skill/scripts/run-adapter-checks.sh .
```

Скрипт выполняет `build`, `lint`, `test:package`, `test:integration`, preflight и repochecker. Не пропускай ошибку. Если названия npm scripts отличаются, обнови scripts проекта и/или аргументированно адаптируй gate.

## 2. Repochecker

Запусти:

```bash
npx --yes @iobroker/repochecker
```

Смотри полный output, устрани все блокирующие и значимые сообщения. При несовпадении с текущей документацией проверь changelog repochecker и schema; не подавляй правило локально.

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

## 7. Критерии допуска

- [ ] Build/lint/package/integration прошли.
- [ ] Repochecker прошёл или все оставшиеся warnings приняты с объяснением.
- [ ] Object dump создан по официальному процессу и проверен.
- [ ] Online Adapter Checker запущен и замечания обработаны.
- [ ] npm pack содержит только ожидаемые файлы.
- [ ] README на английском заполнен, есть ссылка на устройство/производителя и changelog.
- [ ] `io-package.json` содержит корректные типы, roles, authors, titles и Admin3 UI.
- [ ] npm package доступен/готов к публикации и `iobroker` organisation owner добавлена согласно правилам repositories.
- [ ] Непроверенные hardware сценарии обозначены.
