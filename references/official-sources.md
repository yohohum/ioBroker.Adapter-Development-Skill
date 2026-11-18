# Официальные источники ioBroker

Проверка ссылок и API: 12 ноября 2026 года. Указанные GitHub-ветки `main`/`master` изменяются; перед применением проверяйте версию установленного пакета и дату документации.

## Генерация, runtime и типы

| Источник | Для чего читать | Правило |
|---|---|---|
| [@iobroker/create-adapter](https://github.com/ioBroker/create-adapter) | Генерация проекта, варианты JS/TS, Admin UI, тесты, CI | Для нового адаптера запускайте `npx @iobroker/create-adapter@latest`; параметры берите из актуального CLI |
| [@iobroker/adapter-core](https://github.com/ioBroker/adapter-core) | Базовый класс адаптера и runtime API | Проверяйте сигнатуры и совместимость с заявленными js-controller |
| [@iobroker/types](https://www.npmjs.com/package/@iobroker/types) | TypeScript declarations | Пакет не включается автоматически только по имени; подключите через `compilerOptions.types` или `import '@iobroker/types'` |
| [ioBroker.js-controller](https://github.com/ioBroker/ioBroker.js-controller) | Контроллер, runtime, совместимость Node.js | Совместимость проверяйте по разделу Compatibility соответствующего релиза |
| [Adapter development docs](https://www.iobroker.com/docs/dev/adapterdev.md) | Полный процесс разработки | Используйте как общую документацию вместе со схемами и репозиториями инструментов |
| [ioBroker.example](https://github.com/ioBroker/ioBroker.example) | Актуальные эталонные проекты | Не редактируйте/не копируйте generated examples вместо запуска create-adapter |

## Сборка, локальная среда и переводы

| Источник | Для чего читать |
|---|---|
| [@iobroker/adapter-dev](https://github.com/ioBroker/adapter-dev) | `build-adapter`, `translate-adapter`, TypeScript/React сборка и переводы |
| [@iobroker/dev-server](https://github.com/ioBroker/dev-server) | `setup`, `watch`, `run`, `debug`, `upload`, обновление локального Controller/Admin |
| [Перевод адаптера](https://www.iobroker.com/docs/dev/adaptertranslate.md) | Файлы i18n; обязательные English и German; команды перевода |

## Модель объектов и безопасность

| Источник | Для чего читать |
|---|---|
| [Object types](https://github.com/ioBroker/ioBroker.docs/blob/master/docs/en/dev/objectsschema.md) | Допустимые типы объектов и их поля |
| [State roles](https://github.com/ioBroker/ioBroker.docs/blob/master/docs/en/dev/stateroles.md) | Семантика и атрибуты ролей `common.role` |
| [Security for adapter developers](https://github.com/ioBroker/ioBroker.docs/blob/master/docs/en/dev/adaptersecurity.md) | `protectedNative`, `encryptedNative` и ограничения версий |
| [Controller JSON schema](https://github.com/ioBroker/ioBroker.js-controller/blob/master/schemas/io-package.json) | Валидация `io-package.json` — сверяйте путь/схему с установленной версией |

## Admin UI

| Источник | Для чего читать |
|---|---|
| [Admin jsonConfig README](https://github.com/ioBroker/ioBroker.admin/tree/master/packages/jsonConfig) | Конфигурация Admin UI, элементы, валидаторы, зависимости, `jsonConfig.json`/`jsonCustom.json` |
| [Admin jsonConfig schema](https://github.com/ioBroker/ioBroker.admin/tree/master/packages/jsonConfig) | JSON schema для package tests и проверки UI-конфигурации |
| [@iobroker/adapter-react](https://github.com/ioBroker/adapter-react) | React UI, если выбрана React-архитектура |

## Качество, тестирование и приёмка

| Источник | Для чего читать |
|---|---|
| [@iobroker/testing](https://github.com/ioBroker/testing) | `tests.packageFiles`, `tests.integration`, тестовый harness |
| [@iobroker/eslint-config](https://github.com/ioBroker/eslint-config) | Официальная конфигурация ESLint |
| [@iobroker/repochecker](https://github.com/ioBroker/ioBroker.repochecker) | Автоматическая проверка репозитория адаптера |
| [OBJECTDUMP.md](https://github.com/ioBroker/ioBroker.repochecker/blob/master/OBJECTDUMP.md) | Создание и проверка дампа объектов |
| [Adapter Checker](https://adapter-check.iobroker.in/) | Онлайн-проверка репозитория адаптера |
| [ioBroker.repositories](https://github.com/ioBroker/ioBroker.repositories) | Требования и добавление адаптера в latest/stable |

## Релиз и npm

| Источник | Для чего читать |
|---|---|
| [@alcalzone/release-script](https://github.com/AlCalzone/release-script) | Версия, changelog, Git-тег, release workflow |
| [release-script ioBroker plugin](https://github.com/AlCalzone/release-script) | Плагин `@alcalzone/release-script-plugin-iobroker`, обновление `io-package.json` и `news` |
| [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/) | OIDC-публикация npm без долговременного npm token |
| [GitHub Actions OIDC](https://docs.github.com/en/actions/security-for-github-actions/security-hardening-your-deployments/about-security-hardening-with-openid-connect) | Безопасная идентификация workflow |
| [Node.js Release schedule](https://github.com/nodejs/Release) | Поддерживаемые версии Node.js |

## Процедура проверки источника

Перед использованием:

1. Установи, какая версия пакета находится в `package-lock.json`/`npm ls`.
2. Открой README и `engines` именно этой версии (npm/GitHub tag, если доступен).
3. Сверь API с текущей схемой и примерами официального `ioBroker.example`.
4. Запиши проверенные версии Node.js, js-controller, Admin, `@iobroker/testing`, `@iobroker/adapter-dev` и `@iobroker/repochecker`.
5. Повтори проверку при обновлении зависимостей или заявленного минимального runtime.

Не используй числа версий из этого Skill как вечные константы. Они намеренно не зафиксированы в нём.
