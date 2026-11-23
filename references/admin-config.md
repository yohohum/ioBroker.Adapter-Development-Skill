# Admin UI и jsonConfig

Источники: [jsonConfig README/schema](https://github.com/ioBroker/ioBroker.admin/tree/master/packages/jsonConfig), [adapter-dev translations](https://github.com/ioBroker/adapter-dev), [React adapter UI](https://github.com/ioBroker/adapter-react).

## 1. Выбор технологии

Для стандартных настроек используй `admin/jsonConfig.json` (или поддерживаемый проектом `jsonConfig.json5`) и объяви JSON config в `io-package.json` согласно актуальной схеме.

Используй React/adapter-react, только когда UI действительно требует сложной логики/компонентов. Не запрещай React безусловно: обеспечь правильную сборку и включение результата в npm package.

`jsonCustom`/legacy UI используй только при подтверждённой необходимости и с учётом требований latest repository. Проверь текущие правила `ioBroker.repositories`: новый публичный адаптер должен иметь конфигурационный диалог Admin (jsonConfig).

## 2. Валидация

В jsonConfig:

- `validator` — JavaScript-функция, возвращающая `true` при корректном значении и `false` при ошибке;
- `validatorErrorText` — текст ошибки;
- `validatorNoSaveOnError` — запрет сохранения при ошибке, если это применимо.

Не используй `validatorError` как замену `validatorErrorText`. Не помещай регулярное выражение строкой вместо функции, если документация текущей версии ожидает callback/function.

Все конфиги проверяй `tests.packageFiles`: пакет проверяет `io-package.json` по схеме js-controller, а `admin/jsonConfig.json(5)`, `jsonCustom.json(5)` и файл admin tab — по schema jsonConfig. Схемы могут загружаться из интернета; не отключай schema validation только для того, чтобы скрыть ошибку.

## 3. Конфигурация

- задавай безопасные defaults;
- проверяй обязательные поля на backend при старте, не полагайся только на Admin UI;
- явно документируй единицы времени и диапазоны;
- проверь поведение при пустом/пробельном значении;
- избегай произвольных shell commands и HTML injection;
- обеспечь работу при старом сохранённом native config после обновления адаптера;
- не стирай пользовательские настройки при миграции без объяснения и backup.

## 4. Секреты

Поле `password` маскирует ввод, но не выполняет криптографическое шифрование. Сопоставь поля Admin UI с `encryptedNative`/`protectedNative` из `references/security.md` и проверь версии js-controller.

## 5. Переводы

Актуальная документация ioBroker и repochecker требуют переводы на все поддерживаемые языки интерфейса (по текущим требованиям — все 11 языков: en, de, ru, pt, nl, fr, it, es, pl, uk, zh-cn, включая `titleLang`/`desc`/`news` в `io-package.json`). Английский и немецкий — минимум, а не полный перечень.

- тексты конфигурационного интерфейса;
- `title` и `desc` в `io-package.json`;
- release news в `io-package.json`.

Проверяй каждый namespace Admin i18n отдельно во всех 11 языках. Актуальные форматы create-adapter/adapter-dev: `admin/i18n/<lang>.json` для HTML/JavaScript UI, `admin/src/i18n/<lang>.json` для React UI, а также namespace-файлы `src/locales/<lang>/<namespace>.json`/`src/i18n/`, если они используются шаблоном. Устаревший каталог `admin/i18n/<lang>/translations.json` распознаётся для совместимости (repochecker поддерживает его с рекомендацией миграции) и требует миграции на `admin/i18n/<lang>.json`; не смешивай оба формата для одного языка.

Подключи `@iobroker/adapter-dev` как devDependency и сохрани generated scripts. Типовая интеграция пакета выглядит так:

```json
{
  "scripts": {
    "build": "build-adapter",
    "translate": "translate-adapter"
  }
}
```

Команды выбирай по реальным частям проекта и проверяй по README установленной версии: TypeScript — `npm run build typescript`; React UI — `npm run build react`; оба — `npm run build all`. Для перевода HTML/JavaScript Admin UI обычно требуется `npm run translate all`, для React Admin UI — `npm run translate`. Если команда принимает дополнительные аргументы, используй синтаксис `npm run <script> -- <args>`. Добавляй новые строки в исходный English JSON, выполняй перевод штатной командой. Не редактируй устаревший `words.js`, если текущий шаблон его не использует.

## 6. Проверка UI

Проверяй форму в локальном Admin dev-server как минимум в светлой/тёмной теме, с валидными/невалидными значениями, при сохранении и повторном открытии. Проверь поддержку заявленных минимальных версий Admin.
