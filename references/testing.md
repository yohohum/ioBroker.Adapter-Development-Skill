# Тестирование адаптера

Источники: [@iobroker/testing](https://github.com/ioBroker/testing), [@iobroker/eslint-config](https://github.com/ioBroker/eslint-config), [repochecker](https://github.com/ioBroker/ioBroker.repochecker).

## 1. Категории тестов

### Unit tests

Используй Mocha/Chai/Sinon или выбранный в проекте runner для чистой логики:

- протокольный parser/encoder;
- нормализация ID;
- преобразование единиц и диапазонов;
- конфигурационная validation;
- backoff/retry policy;
- redact/log sanitization.

Unit tests не должны запускать копию ioBroker через устаревшие `tests.unit` startup mocks. В актуальном `@iobroker/testing` startup unit-testing deprecated/no-op; mock utilities могут оставаться полезными для отдельных изолированных функций, но не являются подтверждением запуска адаптера.

### Package tests

Обязательно используй `tests.packageFiles(adapterRoot)`. Он проверяет package files и соответствующие JSON-схемы, в частности `io-package.json` и Admin jsonConfig files.

### Integration tests

Обязательно используй `tests.integration(adapterRoot, options)`. Он поднимает настоящий JS-Controller, устанавливает адаптер и даёт harness для запуска и проверки поведения.

Тесты должны покрыть:

- успешный запуск;
- создание ожидаемых объектов и состояний;
- работу с отсутствующей/неполной конфигурацией;
- входящую команду и безопасный результат;
- ошибки устройства/сети;
- доступность/недоступность и reconnect;
- stop без незакрытых таймеров/сокетов;
- обработку сообщений `sendTo`, если адаптер их поддерживает.

## 2. Структура файлов

Рекомендуемая структура (сверь с генератором проекта):

```text
test/
├── package.test.js
├── integration.test.js
└── unit/
    ├── protocol.test.js
    └── normalize-id.test.js
```

Готовые примеры для package/integration — в `templates/adapter-tests/`. В `tests.integration` `defineAdditionalTests` все `it` должны быть внутри `suite`. `allowedExitCodes` добавляй только при доказанном штатном exit behavior; не копируй `[11]` автоматически.

## 3. Сетевые тесты

Для устройства без эмулятора:

- создай отдельный протокольный fake server/fixture;
- тестируй transport logic без внешней сети;
- интеграционный тест запускай с тестовым backend или документированным режимом;
- не утверждай, что fake server подтверждает совместимость с реальным hardware.

Для публичного адаптера желательно иметь hardware smoke-test checklist с моделью/прошивкой, датой и результатом.

## 4. CI

CI должен запускать как минимум:

1. `npm ci`;
2. `npm run build`;
3. `npm run lint`;
4. `npm run test:package`;
5. `npm run test:integration`;
6. `npx --yes @iobroker/repochecker`.

Unit tests запускай как часть `npm test` или отдельного скрипта, если они есть. Не делай их единственным тестом.

Версии Node.js в matrix выбирай по `engines.node` пакета и совместимости заявленных js-controller. Для интеграционных тестов используй актуально поддерживаемые комбинации; не включай EOL Node.js только для искусственного расширения матрицы. Отдельно запускай интеграционный тест на минимально поддерживаемой версии js-controller: шаблон принимает `IOBROKER_TEST_CONTROLLER_VERSION`; незаданная переменная означает `latest`. В CI можно добавить отдельную job/matrix entry с точной минимальной версией.
