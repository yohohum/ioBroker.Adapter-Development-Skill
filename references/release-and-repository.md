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

Если `@alcalzone/release-script` не используется, допустим ручной релиз с тегом: синхронно обнови версии в `package.json`/`io-package.json` и `common.news`, замени `WORK IN PROGRESS` на заголовок версии с датой, создай и запушь тег `vX.Y.Z`. Публикация по-прежнему выполняется стандартным `test-and-release.yml` через `ioBroker/testing-action-deploy@v1` и Trusted Publishing; ручной `npm publish` в CI не добавляй. Для такой схемы используй `release-preflight.mjs . --profile=custom-approved`: профиль не требует release-script, но проверяет версии, changelog и тот же стандартный workflow.

Перед релизом:

- рабочее дерево чистое;
- changelog обновлён и проверен;
- версия `package.json` и `io-package.json` синхронизируется плагином;
- build/tests проходят;
- release type определён явно;
- сначала используйте `--dry` при новой конфигурации;
- не делайте force push для отката публичного релиза.

## 7. npm Trusted Publishing

Официальный [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/) использует OIDC и не требует долговременного `NPM_TOKEN`, если publisher настроен правильно. Схема не зависит от release-script: она работает и при ручном создании тега `vX.Y.Z`, если публикующий workflow запускается по этому тегу.

На текущей документации npm необходимы npm CLI `11.5.1+` и Node.js `22.14.0+`. Проверяй актуальные требования перед релизом.

Для GitHub Actions:

- workflow запускается по релизным тегам `vX.Y.Z` и при необходимости prerelease тегам;
- `permissions.id-token: write` включено;
- `actions/setup-node` настроен с `registry-url: https://registry.npmjs.org`;
- caching отключён в publish workflow, как рекомендует npm;
- публикация выполняется через `ioBroker/testing-action-deploy@v1` (Trusted Publishing, без `npm-token`);
- имя репозитория, имя файла workflow (`test-and-release.yml`) и GitHub environment (если используется) точно совпадают с настройкой Trusted Publisher в npm.

Пример workflow — `templates/github-actions/test-and-release.yml` (официальный шаблон `@iobroker/create-adapter` с действием `ioBroker/testing-action-deploy`). Используй конфигурацию, соответствующую выбранному способу публикации. Версия Node.js — 22.x; измени только после проверки актуальных требований npm и adapter engines.
