# Приёмка, ioBroker.repositories и релизы

## 1. Repochecker

[`@iobroker/repochecker`](https://github.com/ioBroker/ioBroker.repochecker) проверяет, можно ли добавить GitHub repository адаптера в публичный репозиторий ioBroker. Используй локальный CLI, а также автоматическую проверку при PR в `ioBroker.repositories`.

Запускай с указанием URL GitHub-репозитория адаптера:

```bash
npx --yes @iobroker/repochecker@latest https://github.com/<OWNER>/ioBroker.<adaptername>
```

Для дополнительной локальной предварительной проверки с URL и env-файлом:

```bash
npx --yes @iobroker/repochecker@latest https://github.com/<OWNER>/ioBroker.<adaptername> --local --env .repochecker.env
```

Не используй `--local` с пустым или локальным путём вместо URL. Local mode не заменяет удалённый запуск и проверку в ioBroker.repositories.

## 2. OBJECTDUMP

Следуй [официальному OBJECTDUMP.md](https://github.com/ioBroker/ioBroker.repochecker/blob/master/OBJECTDUMP.md) без замены его собственного процесса самодельным `iobroker object list`.

Дамп должен отражать реальную структуру объектов после запуска адаптера. Удали/замаскируй credentials, персональные данные и значения, которые не требуются для проверки. Не загружай приватный dump в публичный PR.

Локальный `scripts/check-object-dump.mjs` проверяет только общую структуру JSON и базовые инварианты; он не заменяет официальный OBJECTDUMP workflow и repochecker.

## 3. Онлайн Adapter Checker

Открой [adapter-check.iobroker.in](https://adapter-check.iobroker.in/), передай URL публичного GitHub-репозитория и исправь все замечания. Сохрани дату/результат в заметках проекта. Онлайн-проверку нельзя честно объявить выполненной, если агент не открыл сервис и не получил результат.

## 4. Репозиторий GitHub и npm

Для добавления в latest/stable проверь актуальные правила `ioBroker.repositories`. На дату текущей проверки там указано:

- GitHub repository: `ioBroker.<adaptername>` (с заглавной B в `ioBroker`);
- npm package name: lowercase;
- добавить GitHub topics;
- не использовать слова `ioBroker` или `Adapter` в отображаемом title;
- README должен содержать описание/детали/changelog на английском языке и ссылку на описание устройства или сайт производителя;
- должна быть лицензия;
- нужен GitHub Actions базовый testing (install/run);
- в `io-package.json` должны быть заданы применимые adapter type и connection type;
- каждый state должен иметь корректную роль;
- должны быть указаны author/authors согласно текущим требованиям;
- пакет должен быть опубликован в npm, а организация `iobroker` добавлена как owner;
- новый адаптер должен иметь конфигурационный диалог Admin (jsonConfig).

Точные требования проверяй в README репозитория, так как они могут меняться.

## 5. Добавление в latest

В официальном `ioBroker.repositories` описан способ CLI:

```bash
npm install
npm run addToLatest -- --name <adapter-name> --type <adapter-type>
```

`<adapter-name>` указывается без префикса `iobroker.`; `<adapter-type>` должен соответствовать актуальному справочнику. Затем сделай commit изменений `sources-dist.json` и PR.

Также может быть доступен web frontend `iobroker.dev` с действием `ADD TO LATEST`. Используй только текущий официальный процесс.

STABLE — отдельный процесс после достаточного тестирования latest; не обещай автоматический перевод в stable.

## 6. Release Script и ручной релиз

`@alcalzone/release-script` сам по себе не гарантирует синхронизацию `io-package.json`: для этого подключи и загрузи плагин `@alcalzone/release-script-plugin-iobroker`. Используй конфигурацию `.releaseconfig.json`, где plugins include `iobroker` (и при необходимости `license`).

Поддерживай раздел `WORK IN PROGRESS` вручную. Release script использует changelog placeholder и превращает его в заголовок версии с датой в `README.md`; он не должен считаться генератором содержательного changelog из произвольной истории Git. Не переноси `WORK IN PROGRESS` в `CHANGELOG_OLD.md`: этот архив предназначен только для версий, выходящих за последние пять релизов (S6020).

Если `@alcalzone/release-script` не используется, допустим ручной tag release через явно выбранный `custom-approved` profile. Синхронизируй `package.json.version` и `io-package.json.common.version`, проверь package metadata, оформи changelog в README и следующий WIP, создай tag `vX.Y.Z`, затем запусти release workflow с обязательными validations. Профиль проверяет tag trigger, validation-job contents, все `needs`, tag condition, OIDC permissions, отсутствие npm token, единственный publish path, GitHub Release и version consistency. Общая Action/path/symlink/YAML policy сохраняется. См. `workflows/09-release.md`.

Перед релизом:

- рабочее дерево чистое;
- changelog обновлён и проверен;
- версия `package.json` и `io-package.json` синхронизируется плагином;
- build/tests проходят;
- release type определён явно;
- сначала используйте `--dry` при новой конфигурации;
- не делайте force push для отката публичного релиза.

## 7. npm Trusted Publishing

Официальный [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/) использует OIDC и не требует долговремого npm publish token, если publisher настроен правильно. Схема не зависит от release-script и может работать при ручном создании тега `vX.Y.Z`, если доверенное workflow настроено точно и проходит проверки.

На текущей документации npm необходимы npm CLI `11.5.1+` и Node.js `22.14.0+`. Проверяй актуальные требования перед релизом.

Для GitHub Actions:

- GitHub Actions workflow запускается по tags; npm docs требуют указать owner/organization, repository, workflow filename (только filename, включая `.yml`/`.yaml`) и при необходимости environment;
- `permissions.id-token: write` включено на publish job; выдавай минимум permissions;
- `actions/setup-node` настроен с `registry-url: https://registry.npmjs.org`;
- для прямого npm publish на release workflow caching не используется, как рекомендует npm;
- публикация выполняется без долгосрочного npm token; `id-token: write` позволяет GitHub выдать OIDC token;
- package `repository.url` точно соответствует GitHub repository. Настройку Trusted Publisher выполняет владелец пакета на npmjs.com; GitHub-hosted runners поддерживаются, self-hosted runners в текущей npm документации не поддерживаются.

Пример workflow — `templates/github-actions/test-and-release.yml` (официальный шаблон `@iobroker/create-adapter` с действием `ioBroker/testing-action-deploy`). Используй конфигурацию, соответствующую выбранному способу публикации. Версия Node.js — 22.x; измени только после проверки актуальных требований npm и adapter engines.
