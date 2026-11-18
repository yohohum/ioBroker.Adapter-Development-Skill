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
   bash /path/to/skill/scripts/run-adapter-checks.sh .
   ```

   Этот скрипт предполагает наличие `npm`-скриптов `build`, `lint`, `test:package`, `test:integration` и доступ к npm Registry для запуска repochecker.

## Структура

```text
.
├── SKILL.md
├── README.md
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
│   ├── release-preflight.mjs
│   ├── run-adapter-checks.sh
│   └── validate-skill.mjs
└── templates/
    ├── adapter-tests/
    │   ├── testPackageFiles.cjs
    │   └── testAdapter.integration.cjs
    ├── changelog/CHANGELOG.md
    ├── release/releaseconfig.json
    └── github-actions/
        ├── adapter-ci.yml
        └── npm-publish.yml
```

## Что проверяет Skill

- корректность package/io-package и синхронизацию версий;
- базовую структуру дампа объектов и семантику ролей;
- наличие интеграционных тестов с JS-Controller;
- сборку, lint и repochecker;
- changelog, release-script и конфигурацию npm Trusted Publishing.

Скрипты — дополнительный контроль, а не замена `@iobroker/testing`, `@iobroker/repochecker`, Adapter Checker или ручного тестирования оборудования.

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
