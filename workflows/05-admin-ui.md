# Этап 5. Admin UI, конфигурация и переводы

## 1. Выбор интерфейса

Используй jsonConfig для простых и средних форм настроек. Для сложного интерфейса выбирай поддерживаемую текущим генератором React-интеграцию. Не делай категоричный запрет React и не оставляй React без сборки.

## 2. Конфигурационный контракт

Для каждого поля укажи:

- key и тип;
- mandatory/optional;
- default;
- validation;
- секретность;
- использование в runtime;
- миграцию при смене формата.

Backend проверяет native config независимо от UI. Обработай старые конфиги.

## 3. jsonConfig

Сверь каждое поле со схемой Admin. `validator` должен быть функцией согласно актуальной документации, ошибка — в `validatorErrorText`. Не используй поля, которых нет в schema.

После изменений запускай package tests, так как они проверяют jsonConfig schema. Также запусти dev-server и проверь форму в реальном Admin.

## 4. Секреты

Для credentials оцени `encryptedNative` и `protectedNative`. Не путай input type `password` с encryption. Не выводи секреты в log/diagnostic `sendTo`.

## 5. Переводы

Запусти штатный `translate-adapter` команды в соответствии с выбранным UI и README `@iobroker/adapter-dev`.

Для НОВОГО адаптера, подаваемого в `ioBroker.repositories`, repochecker требует переводы на ВСЕ 11 языков (en, de, ru, pt, nl, fr, it, es, pl, uk, zh-cn):
- `common.titleLang`, `common.desc`, `common.news` в `io-package.json`;
- переводы Admin UI: для jsonConfig — локали внутри `admin/jsonConfig.json(5)` (поля `label`, `desc` с объектом языков); для React — актуальные файлы `admin/src/i18n/<lang>.json`, а также namespace-файлы в `src/locales/<lang>/<namespace>.json`/`src/i18n/`, если это выбрано шаблоном create-adapter. Проверяй каждый namespace отдельно во всех 11 языках.

Для СУЩЕСТВУЮЩИХ адаптеров при обновлении достаточно en + de.

Команда `npm run translate` генерирует все языки автоматически. Не редактируй файлы переводов вручную — только исходный en JSON.

Проверь полноту переводов скриптом `scripts/check-translations.mjs --mode=new` (для новых адаптеров) или `--mode=existing` (для существующих). Скрипт проверяет:
- `common.titleLang`, `common.desc`, `common.news` в `io-package.json`;
- локализованные поля jsonConfig (`label`, `desc`, `validatorErrorText`);
- React-локали (`admin/src/i18n/<lang>.json`, `src/locales/<lang>/<namespace>.json`, `src/i18n/`) и HTML/JavaScript i18n с наборами ключей;
- пустые каталоги, пустые строки и отсутствие отдельного namespace хотя бы в одном языке.

Режим `auto` не выбирает `existing` автоматически: если тип проекта нельзя определить однозначно, скрипт возвращает `NEEDS REVIEW` с ненулевым exit code. Для предрелизной проверки нового адаптера всегда используй `--mode=new`.

Актуальный HTML/JavaScript-формат create-adapter/adapter-dev — `admin/i18n/<lang>.json`. Каталог `admin/i18n/*/translations.json` — устаревший формат: он распознаётся для совместимости (repochecker поддерживает его с рекомендацией миграции), скрипт выдаёт сообщение о миграции. Для нового адаптера сразу используй `admin/i18n/<lang>.json`; не смешивай оба формата для одного языка.

## Критерии завершения

- [ ] Admin config schema validation проходит.
- [ ] Backend config validation проходит.
- [ ] Default config создаёт рабочую/понятную форму.
- [ ] Старый native config не ломает адаптер.
- [ ] Секреты корректно защищены и не логируются.
- [ ] Admin UI проверен через dev-server.
- [ ] Переводы синхронизированы штатным инструментом.
