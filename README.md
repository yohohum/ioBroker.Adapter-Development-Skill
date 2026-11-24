# ioBroker Adapter Development Skill

Полный GitHub Skill для ИИ-агентов, разрабатывающих адаптеры ioBroker: от анализа протокола и генерации каркаса до тестирования, проверки репозитория и релиза.

## Главный принцип

Официальная документация и схемы ioBroker — единственный источник истины для API, моделей объектов, ролей, Admin UI и требований приёмки. Этот репозиторий организует процесс и содержит вспомогательные проверки, но не заменяет документацию и не гарантирует совместимость с будущими версиями без повторной проверки.

## Быстрый старт

1. Склонируйте этот репозиторий или скопируйте папку Skill в каталог, который индексирует ваш ИИ-агент.
2. Убедитесь, что агент умеет читать `SKILL.md`, открывать внешние ссылки и выполнять shell/Node.js команды в рабочем репозитории.
3. Передайте агенту задачу создать или изменить адаптер и явно потребуйте применять `SKILL.md`.
4. Для нового адаптера агент должен начать с официального генератора:

   ```bash
   npx @iobroker/create-adapter@latest
   ```

5. Внутри проекта адаптера установите зависимости, затем после реализации запустите проверки:

   ```bash
   npm ci
   bash /path/to/skill/scripts/run-adapter-checks.sh https://github.com/<OWNER>/ioBroker.<adaptername>
   ```

   Этот скрипт предполагает наличие `npm`-скриптов `build`, `lint`, `test:package`, `test:integration` и доступ к npm Registry для запуска repochecker.

## Структура

```text
.
├── SKILL.md
├── README.md
├── README.en.md
├── CONTRIBUTING.md
├── LICENSE
├── .editorconfig
├── .gitignore
├── .github/workflows/validate-skill.yml
├── references/
│   ├── official-sources.md
│   ├── object-model.md
│   ├── security.md
│   ├── transports.md
│   ├── admin-config.md
│   ├── testing.md
│   └── release-and-repository.md
├── workflows/
│   ├── 01-discovery.md
│   ├── 02-scaffolding.md
│   ├── 03-architecture.md
│   ├── 04-implementation.md
│   ├── 05-admin-ui.md
│   ├── 06-debugging.md
│   ├── 07-testing.md
│   ├── 08-release-gate.md
│   └── 09-release.md
├── scripts/
│   ├── adapter-preflight.mjs
│   ├── check-object-dump.mjs
│   ├── check-translations.mjs
│   ├── release-preflight.mjs
│   ├── run-adapter-checks.sh
│   ├── validate-skill.mjs
│   └── lib/
│       ├── action-refs.mjs
│       ├── deploy-condition.mjs
│       └── publish-workflow.mjs
├── templates/
│   ├── adapter-tests/
│   │   ├── testPackageFiles.cjs
│   │   └── testAdapter.integration.cjs
│   ├── changelog/
│   │   ├── CHANGELOG_OLD.md
│   │   └── README-changelog-section.md
│   ├── release/releaseconfig.json
│   └── github-actions/
│       ├── adapter-ci.yml
│       └── test-and-release.yml
└── test/
    ├── fixtures/
    │   ├── translations/
    │   └── release/
    └── run-regression-tests.mjs
```

## Что проверяет Skill

- корректность package/io-package и синхронизацию версий;
- базовую структуру дампа объектов и семантику ролей;
- наличие интеграционных тестов с JS-Controller;
- сборку, lint и repochecker;
- changelog, release-script и конфигурацию npm Trusted Publishing.

Скрипты — дополнительный контроль, а не замена `@iobroker/testing`, `@iobroker/repochecker`, Adapter Checker или ручного тестирования оборудования.

### Проверка GitHub Actions релиза

В стандартном профиле `create-adapter-default` разрешён allowlist, разделённый на две группы:

**A. Actions официального шаблона** (используются `test-and-release.yml`, требуются для стандартного профиля):
- `actions/checkout@v6`
- `actions/setup-node@v6`
- `ioBroker/testing-action-check@v2`
- `ioBroker/testing-action-adapter@v1`
- `ioBroker/testing-action-deploy@v1`

**B. Дополнительные разрешённые Actions** (не входят в официальный шаблон, разрешены для пользовательских и расширенных сценариев):
- `actions/upload-artifact@v6` — основание: используется внутри `ioBroker/testing-action-adapter@v1` для архивации скриншотов; может потребоваться для пользовательской публикации артефактов.
- `softprops/action-gh-release@v3` — основание: используется внутри `ioBroker/testing-action-deploy@v1` для создания GitHub-релиза; может потребоваться для пользовательских сценариев релиза.

Ref сверяется целиком с политикой. Неизвестные Actions, внешние reusable workflows и недоступные для проверки конструкции отклоняются. Локальные reusable workflows и composite Actions обходятся рекурсивно; inputs reusable workflow сверяются с `on.workflow_call`. Inputs проверяются по именам, обязательности, типам и документированным ограничениям официальных `action.yml` (для `actions/upload-artifact@v6` допустимы только name, path, if-no-files-found, retention-days, compression-level, overwrite, include-hidden-files; параметра `archive` в официальном контракте v6 нет). Пользовательский профиль `custom-approved` использует тот же allowlist Actions, что и `create-adapter-default`; он не расширяет набор разрешённых Actions и не снимает fail-closed политику. Каждое действие из allowlist требует фиксированного ref и задокументированного контракта. FAIL означает обнаруженное нарушение, NEEDS REVIEW — безопасность автоматически не подтверждена.

## Установка в репозиторий агента

Рекомендуемый вариант — держать Skill как отдельный репозиторий и подключать его в соответствующий каталог агента. Если агенту нужен одиночный файл, используйте полный `SKILL.md`, но для полного процесса нужны также `references/`, `workflows/`, `scripts/` и `templates/`.

## Установка в GitHub

Создайте репозиторий, например `ioBroker.Adapter-Development-Skill`, скопируйте всё содержимое этого каталога в корень и выполните:

```bash
git init
git add .
git commit -m "Initial ioBroker adapter development skill"
git branch -M main
git remote add origin https://github.com/<OWNER>/ioBroker.Adapter-Development-Skill.git
git push -u origin main
```

Замените `<OWNER>` на владельца репозитория. Перед публичным использованием проверьте лицензию, настройки доступа и путь, по которому ваш агент обнаруживает skills.

## Обновление

При обновлении ioBroker проверяйте `references/official-sources.md`, затем пересматривайте шаблоны и скрипты. Не повышайте минимальные версии js-controller/Node.js без проверки матрицы совместимости. Все изменения самого Skill должны проходить `.github/workflows/validate-skill.yml`.

## Официальные первоисточники

Сводный список и назначение каждого источника — в [`references/official-sources.md`](references/official-sources.md).
