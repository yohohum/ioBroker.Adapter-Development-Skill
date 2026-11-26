# Этап 9. Версионирование и публикация

## 1. Предварительные условия

Релиз запрещён, пока не пройдены критерии `08-release-gate.md`. Проверь чистое Git working tree, активную release branch и согласованную версию.

## 2. Changelog

Поддерживай раздел **WORK IN PROGRESS** в начале changelog в `README.md` (см. шаблон `templates/changelog/README-changelog-section.md`). Записи должны быть понятны пользователю и описывать значимые изменения. Release-script форматирует этот placeholder в версионную запись, но не генерирует содержательный changelog из Git commits.

При обычном релизе release-script преобразует **WORK IN PROGRESS** в заголовок новой версии с датой в changelog `README.md` и готовит новый placeholder для последующих изменений. Не переноси текущие записи WIP вручную в `CHANGELOG_OLD.md`. При альтернативном ручном tag release владелец выполняет только те операции преобразования changelog, которые не выполняются release-script: оформить выпущенную версию в README и создать следующий WIP.

`CHANGELOG_OLD.md` — архив старых версий сверх последних пяти, согласно S6020 repochecker. При накоплении более пяти версий архивируй только самые старые уже выпущенные записи, сохраняя пять последних версий в README. Это обслуживание архива, а не часть обычного релизного переноса WIP.

Не создавай отдельный `CHANGELOG.md` — актуальная схема хранит changelog в README, а старые записи архивируются в `CHANGELOG_OLD.md`.

## 3. Release Script

Добавь как devDependencies:

- `@alcalzone/release-script`;
- `@alcalzone/release-script-plugin-iobroker` (для обновления `io-package.json` и news);
- при необходимости `@alcalzone/release-script-plugin-license`.

Скопируй `templates/release/releaseconfig.json` в корень проекта под именем `.releaseconfig.json` и проверь состав plugins в соответствии с установленными пакетами. Базовый пример:

```json
{
  "plugins": ["iobroker", "license"]
}
```

Добавь package script:

```json
{
  "scripts": {
    "release": "release-script"
  }
}
```

Используй точную документацию установленной версии `release-script` и плагинов. Перед первым выпуском и непосредственно перед выбранным релизом проверь:

```bash
node /path/to/skill/scripts/release-preflight.mjs .
npm run release -- --help
npm run release patch -- --dry
```

После проверки выполни выбранный bump (`patch`, `minor`, `major` или корректный prerelease) вручную. Не запускай публикацию без разрешения пользователя.

`package.json` и `io-package.json` должны иметь согласованные версии согласно правилам используемого plugin. Для prerelease режимов явно проверь опцию `--ioPackageNoPrerelease` и не включай её без обоснования. Если она используется, запускай `adapter-preflight.mjs` и `release-preflight.mjs` с флагом `--allow-io-package-no-prerelease`; не ослабляй синхронизацию версий для обычных релизов.

### 3.1. Ручной релиз с тегом и Trusted Publishing

Если проект использует альтернативную ручную подготовку версии и Git tag, используй явно выбранный профиль `custom-approved`. Это отдельный строгий tag-based Trusted Publishing contract, а не разрешение произвольного workflow:

1. Подготовь bump версии и метаданные. Сверь `package.json.version` с `io-package.json.common.version`; проверь `common.news` и `npm pack --dry-run`. Не включай неопубликованную версию в news до публикации.
2. Подготовь changelog в README: релизная запись должна отражать фактическое содержимое WIP, затем создай следующий WIP. Не архивируй текущий WIP в `CHANGELOG_OLD.md`.
3. Проверь `.github/workflows/test-and-release.yml` и выполни `node /path/to/skill/scripts/release-preflight.mjs . --profile=custom-approved`. Для другого имени workflow укажи `--workflow=.github/workflows/<file>.yml`.
4. Разрешённый trigger glob GitHub — только `v*` (это glob, не regex). Deploy обязан fail-closed проверить полное имя `vX.Y.Z` с допустимым prerelease suffix, сравнить его с `package.json` и `io-package.json`, и публиковать только при совпадении. Убедись, что тег указывает на проверенный commit; создай и запушь tag, без branch-triggered publication.
5. GitHub Actions должны выполнить lint/build, adapter/package tests и другие проектные checks. Обязательные validation jobs и их ключевые steps — unconditional (без `if` и `continue-on-error`); Deploy зависит от всех таких jobs и использует условие ровно `startsWith(github.ref, 'refs/tags/v')`; skipped/failed prerequisite блокирует публикацию.
6. Publish выполняется одним разрешённым механизмом: прямой `npm publish` с OIDC, numeric pin npm CLI `>= 11.5.1`, Node.js `>= 22.14.0` и явной защитой от уже опубликованной версии. `actions/setup-node` для публикации обязан задавать `registry-url: https://registry.npmjs.org` и `package-manager-cache: false`. `ioBroker/testing-action-deploy@v1` допускается только при явном numeric `npm-version >= 11.5.1` и `package-cache: 'false'`. GitHub Actions Trusted Publishing автоматически создаёт provenance, флаг `--provenance` не нужен. Не добавляй второй publish path.
7. npm Trusted Publisher должен быть предварительно настроен владельцем пакета на npmjs.com: GitHub Actions, точные owner/organization, repository и имя workflow file (только filename, с `.yml`/`.yaml`); environment укажи только если workflow реально его использует. Workflow использует GitHub-hosted runner и имеет `id-token: write` только на deploy job. `contents: write` требуется только для GitHub Release. Permissions должны быть заданы явно (workflow-level mapping); `read-all` и `write-all` запрещены, а `id-token: write` и `contents: write` на уровне workflow не допускаются — они разрешены только в job `deploy`. Остальные jobs используют минимальные права (обычно `contents: read`).
8. После успеха проверь версию через `npm view <package>@<version> version`, provenance (если доступно), GitHub Release/tag и release notes. Проверь, что опубликованная версия появилась в npm до включения её в news и финального repochecker.
9. При ошибке до публикации исправь workflow/commit и создай новый тег с новой версией только если изменился пакет. После успешной публикации ту же версию повторно не публикуй: npm отвергает повторное создание уже опубликованной версии; восстановление выполняй новым patch-релизом. Не переписывай и не перемещай уже опубликованный тег.

`custom-approved` не требует `@alcalzone/release-script` и валидирует отдельный структурный контракт. Standard profile остаётся default; custom включается только явным `--profile=custom-approved`. Общие Actions allowlist, pinning refs, рекурсивная проверка вложенных workflows/composite actions, inputs/secrets, cycle/path/symlink и YAML duplicate-key checks применяются к обоим профилям. Неизвестные Actions и floating refs запрещены.

## 4. Git tag и workflows

При использовании release-script он создаёт release commit/tag и push согласно своей конфигурации. При ручном релизе создай и запушь тег `vX.Y.Z` сам (см. 3.1). Standard profile использует workflow `test-and-release.yml` от `@iobroker/create-adapter`; custom profile может использовать только workflow, проходящий отдельную tag-based Trusted Publishing проверку.

Не добавляй невалидируемый `npm-publish.yml` или произвольный publish step. Custom profile допускает только один строго ограниченный `npm publish` через OIDC при выполнении version, prerequisite, token, duplicate-version и release checks. Для GitHub Actions Trusted Publishing npm автоматически создаёт provenance; добавление `--provenance` не требуется.

CI для веток/PR и publish по тегам разделяй: публикация не должна срабатывать на произвольный push в main.

## 5. npm Trusted Publishing

Trusted Publishing не зависит от release-script, но требует корректно настроенного npm Trusted Publisher и поддерживаемого npm CLI/runtime. Для GitHub Actions документация npm указывает npm CLI `11.5.1+` и Node.js `22.14.0+`; перепроверь актуальные требования перед релизом.

В npmjs.com настрой Trusted Publisher для репозитория:

1. GitHub Actions provider;
2. owner/organization и repository;
3. точное имя workflow file, только filename с расширением, без полного пути;
4. environment — только если workflow использует GitHub environment.

В `test-and-release.yml` НЕ указывай `npm-token`. Минимальный publish-фрагмент для `custom-approved`:

```yaml
- name: Release guard
  shell: bash
  run: |
    set -euo pipefail
    # release-guard-contract: v1
    TAG_VERSION="${GITHUB_REF_NAME#v}"
    [[ "$GITHUB_REF_NAME" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || { echo "::error::Invalid release tag"; exit 1; }
    PKG_VERSION="$(node -p "require('./package.json').version")"
    IO_VERSION="$(node -p "require('./io-package.json').common.version")"
    if [ "$TAG_VERSION" != "$PKG_VERSION" ] || [ "$TAG_VERSION" != "$IO_VERSION" ]; then
      echo "::error::Release versions do not match"
      exit 1
    fi
    PACKAGE_NAME="$(node -p "require('./package.json').name")"
    set +e
    NPM_VIEW_OUTPUT="$(npm view "$PACKAGE_NAME@$PKG_VERSION" version 2>&1)"
    NPM_VIEW_STATUS=$?
    set -e
    if [ "$NPM_VIEW_STATUS" -eq 0 ]; then
      echo "::error::Package version already exists"
      exit 1
    fi
    if ! printf '%s' "$NPM_VIEW_OUTPUT" | grep -Eq 'E404|404 Not Found|is not in (this|the) npm registry|No match found for version'; then
      echo "::error::Unable to verify npm publication state: $NPM_VIEW_OUTPUT"
      exit 1
    fi
- uses: actions/setup-node@v6
  with:
    node-version: '24'
    registry-url: 'https://registry.npmjs.org'
    package-manager-cache: false
- run: npm install --global npm@11.5.1
- run: npm publish
```

Валидатор принимает только этот проверенный скрипт версии с заголовком `release-guard-contract: v1`; любое отклонение (другие поля, оболочка, `if`, `continue-on-error`, комментарий вместо шага) отклоняется.

Если используешь `ioBroker/testing-action-deploy@v1`, обязательно задай numeric `npm-version: "11.5.1"` (или выше), статический `node-version` не ниже `22.14.0` и `package-cache: 'false'`; без `npm-version` action ставит floating npm@11 и не проходит custom-approved.

Требуй `id-token: write` для OIDC publish и `contents: write` для создания GitHub Release. Ограничивай write permissions deploy job, где возможно; остальные jobs должны использовать минимальные права (обычно `contents: read`). Для npm trusted publisher имя owner/repository/workflow case-sensitive и должно совпадать с настройкой на npmjs.com. Настройку выполняет владелец пакета в package settings → Trusted Publisher; npm требует успешный первый publish в течение двух дней после создания конфигурации.

Не используй npm long-lived publish tokens. Не документируй их как fallback. npm Trusted Publishing GitHub Actions автоматически создаёт provenance для поддерживаемых публичных пакетов; `--provenance` для этой OIDC-схемы не требуется. Если профиль использует ручной `npm publish`, добавляй provenance только согласно актуальной npm CLI документации.

Для prerelease тегов публикуй в `next`/другой явно выбранный dist-tag, чтобы случайно не переместить prerelease в `latest`. Для стабильной версии используй default `latest`, если это соответствует политике пакета.

## 6. GitHub Release

После успешной публикации создай GitHub Release по тому же tag, используя release notes из changelog или проверенные generated notes. Убедись, что release job имеет только необходимые permissions.

## 7. Проверка результата

После публикации проверь:

- npm пакет и версия доступны в registry;
- `npm view <package>@<version>` показывает правильные metadata;
- tarball содержит нужные файлы;
- GitHub tag/release соответствуют версии;
- `io-package.json` version/news синхронизированы;
- npm provenance/trusted publisher status — если доступно для этой публикации;
- `ioBroker.repositories` latest updated и PR создан по официальному процессу.

## 8. Откат

Не переписывай общую историю через `git reset --hard` + `git push --force`. Для опубликованного релиза используй исправляющий commit и новый PATCH-релиз; если пакет нужно временно снять/заблокировать, действуй по актуальной политике npm/ioBroker и согласуй это с владельцем пакета.
