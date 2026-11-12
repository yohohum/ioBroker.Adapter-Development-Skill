# ioBroker Adapter Development Skill

Этот документ определяет строгий стандарт разработки адаптеров для ioBroker. ИИ-агент должен использовать его как единственный источник истины.

## Золотые правила агента:
1. **Типизация**: Всегда используй `@iobroker/types` и TypeScript (или JSDoc с строгой типизацией).
2. **Ядро**: Всегда наследуйся от `utils.Adapter` или `Adapter` из `@iobroker/adapter-core` (версия 3.x+).
3. **Роли**: Используй только официальные роли из `STATE_ROLES.md`. Не придумывай свои.
4. **Конфигурация**: Используй исключительно `jsonConfig.json` (или `jsonCustom.json`) для настроек в админке.
5. **Тесты**: Каждый адаптер должен проходить `test:package`, `test:unit` (если применимо) и `test:integration`.
6. **CI/CD**: Релизы выполняются только через `@alcalzone/release-script` и GitHub Actions (Trusted Publishing).
7. **Безопасность**: Секреты храни в `protectedNative` в `io-package.json`, никогда не коммить их в код.
8. **Объекты**: Всегда определяй `common.type`, `common.role`, `common.read`, `common.write` для всех состояний.

## Структура документации:
- `01-SETUP.md` - Создание и каркас адаптера
- `02-DEVELOPMENT.md` - Разработка, отладка и конфигурация
- `03-TESTING.md` - Тесты и стиль кода
- `04-PRE-SUBMISSION.md` - Проверка перед приёмом в репозиторий
- `05-RELEASE.md` - Релизы и публикация
