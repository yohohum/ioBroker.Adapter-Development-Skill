# Этап 7. Тестирование

## 1. Подготовка

Установи актуальную совместимую версию `@iobroker/testing`; смотри npm package `engines` и README. Не копируй версии из старых инструкций.

Обеспечь scripts (конкретные команды могут соответствовать генератору проекта):

```json
{
  "scripts": {
    "build": "<generated build command>",
    "lint": "<generated lint command>",
    "test:package": "<mocha package tests>",
    "test:integration": "<mocha integration tests>",
    "test": "npm run test:package && npm run test:integration"
  }
}
```

Сохраняй generated commands и добавляй только отсутствующие.

## 2. Package tests

Скопируй `templates/adapter-tests/testPackageFiles.cjs` в проект (обычно `test/package.test.js`) и адаптируй путь, если изменилась структура. Запусти `npm run test:package`.

Не отключай `ignoreIoPackageValidation`/`ignoreJsonConfigValidation` для маскировки ошибки. Если schema validation технически недоступна, фиксируй это как BLOCKED, а локальные тесты не выдавай за полную проверку схем.

## 3. Integration tests

Скопируй `templates/adapter-tests/testAdapter.integration.cjs`, проверь `adapterRoot`, добавь собственные suite. Все `it`/`describe` для `defineAdditionalTests` должны регистрироваться через `suite`, согласно README testing.

`allowedExitCodes` по умолчанию не указывай. Добавляй только если доказано и задокументировано, что адаптер штатно завершается в процессе тестового запуска именно с таким кодом.

Не используй `expect`, если он не импортирован. В примерах ниже нет глобальных assertion-библиотек: импортируй их явно при добавлении проверок.

## 4. Unit tests

Покрывай чистую бизнес-логику. Не проверяй только mock DB, которая сама создала объект; такой тест не доказывает, что адаптер создал его.

## 5. Полезные негативные сценарии

- пустой hostname/IP;
- неверный пароль/token;
- timeout;
- malformed JSON/frame;
- неподдерживаемая модель/firmware;
- устройство отключается в середине запроса;
- два устройства отвечают одновременно;
- duplicate event;
- команда вне диапазона;
- команда во время stop/reconnect;
- старый/неполный native config;
- перезапуск с уже созданными objects.

## 6. Тестирование совместимости

Проверь Node.js версии, заявленные в package engines и совместимые с поддерживаемыми js-controller. Проверяй минимальную поддерживаемую версию контроллера, а не только `latest`.

## Критерии завершения

- [ ] Package schema tests проходят.
- [ ] Integration tests проходят на реальном JS-Controller.
- [ ] Unit tests покрывают чистую логику, если она есть.
- [ ] Негативные сетевые/командные сценарии проверены.
- [ ] Нет зависших процессов, таймеров и ресурсов.
- [ ] Результаты и версии сохранены.
