# Этап 9. Версионирование и публикация

## 1. Предварительные условия

Релиз запрещён, пока не пройдены критерии `08-release-gate.md`. Проверь чистое Git working tree, активную release branch и согласованную версию.

## 2. Changelog

Поддерживай `WORK IN PROGRESS` вручную в `CHANGELOG.md` или `README.md` согласно конфигурации release-script. Записи должны быть понятны пользователю и описывать значимые изменения. Не рассчитывай, что release-script автоматически напишет содержательный changelog по Git commits.

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

## 4. Git tag и workflows

Release script создаёт release commit/tag и push согласно своей конфигурации. Публикация выполняется через workflow `test-and-release.yml`, генерируемый `@iobroker/create-adapter`, который использует `ioBroker/testing-action-deploy@v1`.

НЕ используй собственный `npm-publish.yml` или ручной `npm publish` в CI.

CI для веток/PR и publish по тегам разделяй: публикация не должна срабатывать на произвольный push в main.

## 5. npm Trusted Publishing

В npmjs.com настрой Trusted Publisher для репозитория:

1. owner/organization;
2. repository;
3. workflow filename (`test-and-release.yml`);
4. environment (если workflow использует environment).

В `test-and-release.yml` НЕ указывай `npm-token`:

```yaml
- uses: ioBroker/testing-action-deploy@v1
  with:
    node-version: "22.x"
    github-token: ${{ secrets.GITHUB_TOKEN }}
    # npm-token НЕ указывается при Trusted Publishing
```

Permissions workflow должны включать `id-token: write` и `contents: write`.

NPM_TOKEN устарели (истекают через 90 дней) — используй только Trusted Publishing.

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
