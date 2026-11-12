# Этап 5: Релизы

## 5.1. Семантическое версионирование
Следуй правилам [Semantic Versioning](https://semver.org/):

- **MAJOR** (X.0.0) - breaking changes, несовместимые API изменения
- **MINOR** (0.X.0) - новая функциональность, обратная совместимость
- **PATCH** (0.0.X) - исправление ошибок, обратная совместимость

## 5.2. Использование release-script
Никогда не меняй версию вручную в `package.json`. Используй `@alcalzone/release-script`:

```bash
# Патч-релиз (исправление ошибок)
npm run release patch

# Минорный релиз (новые функции)
npm run release minor

# Мажорный релиз (breaking changes)
npm run release major

# Предрелиз (бета)
npm run release prerelease beta

# Сухой запуск (без реальных изменений)
npm run release patch -- --dry
```

**Что делает release-script:**
1. Обновляет версию в `package.json` и `io-package.json`
2. Генерирует `CHANGELOG.md` из Git-коммитов
3. Создает Git-тег
4. Пушит изменения и тег в репозиторий
5. Создает GitHub Release

## 5.3. Настройка CHANGELOG
Используй [Conventional Commits](https://www.conventionalcommits.org/) для автоматической генерации changelog:

**Формат коммитов:**
```
<type>(<scope>): <subject>

<body>

<footer>
```

**Типы:**
- `feat` - новая функциональность
- `fix` - исправление ошибки
- `docs` - изменения документации
- `style` - форматирование кода
- `refactor` - рефакторинг
- `test` - добавление тестов
- `chore` - обслуживание (обновление зависимостей и т.д.)

**Примеры:**
```bash
feat: add support for new device model
fix: resolve connection timeout issue
docs: update README with installation instructions
chore: update dependencies
```

## 5.4. Публикация через GitHub Actions
Используй Trusted Publishing. Файл `.github/workflows/test-and-release.yml` уже содержит необходимый шаг для публикации в npm при создании релиза.

**Не добавляй секреты `NPM_TOKEN` вручную!** Используй `permissions: id-token: write`.

## 5.5. Ручная публикация (не рекомендуется)
Если GitHub Actions не работает, можно опубликовать вручную:

```bash
# После создания релиза через release-script
npm publish
```

Но это не рекомендуется, так как не использует Trusted Publishing.

## 5.6. Проверка публикации
После публикации проверь:

```bash
# Проверить версию в npm
npm view iobroker.my-adapter version

# Проверить доступность пакета
npm install iobroker.my-adapter@latest --dry-run
```

## 5.7. Обновление в ioBroker
После публикации в npm:

1. Создай Pull Request в `ioBroker.repositories` с обновлением версии
2. Дождись проверки и мержа
3. Пользователи смогут обновить адаптер через админку

## 5.8. Откат релиза
Если обнаружены критические проблемы:

```bash
# Удалить тег
git tag -d v1.2.3
git push origin :refs/tags/v1.2.3

# Откатить коммит
git reset --hard HEAD~1
git push --force

# Опубликовать исправленную версию
npm run release patch
```

## 5.9. Чеклист релиза
- [ ] Все тесты проходят
- [ ] `npm run lint` не выдает ошибок
- [ ] CHANGELOG.md обновлен
- [ ] Версия обновлена через `npm run release`
- [ ] Тег создан и запушен
- [ ] GitHub Release создан
- [ ] Пакет опубликован в npm
- [ ] Pull Request в `ioBroker.repositories` создан
