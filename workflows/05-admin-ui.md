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

Запусти штатный `translate-adapter` команды в соответствии с выбранным UI и README `@iobroker/adapter-dev`. Переводы необходимы на все поддерживаемые языки интерфейса (по текущим требованиям repochecker — все 11 языков, включая `titleLang`/`desc`/`news` в `io-package.json`). Английский и немецкий — минимум, а не полный перечень. Переводи UI labels, title/description и release news.

## Критерии завершения

- [ ] Admin config schema validation проходит.
- [ ] Backend config validation проходит.
- [ ] Default config создаёт рабочую/понятную форму.
- [ ] Старый native config не ломает адаптер.
- [ ] Секреты корректно защищены и не логируются.
- [ ] Admin UI проверен через dev-server.
- [ ] Переводы синхронизированы штатным инструментом.
