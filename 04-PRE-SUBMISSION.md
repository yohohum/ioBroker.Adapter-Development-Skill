# Этап 4: Проверка перед приёмом в репозиторий

Перед созданием Pull Request в `ioBroker.repositories` агент **ОБЯЗАН** выполнить следующие шаги:

## 4.1. Локальная проверка
Запусти все проверки:

```bash
# Проверка стиля кода
npm run lint

# Проверка структуры пакетов
npm run test:package

# Интеграционные тесты
npm run test:integration

# Проверка через repochecker
npx @iobroker/repochecker
```

Или одной командой:
```bash
./scripts/run-checks.sh
```

## 4.2. Проверка структуры объектов
Убедись, что все объекты имеют правильную структуру:

```bash
# Получить объект
iobroker object get my-adapter.0.info.connection

# Список всех объектов
iobroker object list my-adapter.0.*
```

Сравни с требованиями из [OBJECTDUMP.md](https://github.com/ioBroker/ioBroker.repochecker/blob/master/OBJECTDUMP.md).

**Обязательные проверки:**
- Все состояния имеют `common.type`, `common.role`, `common.read`, `common.write`
- Роли взяты из официального списка STATE_ROLES
- Имена объектов на английском языке в `common.name`
- Переводы присутствуют в `common.name` для основных языков

## 4.3. Проверка иконок
- Иконка `admin/my-adapter.png` должна быть 256x256 пикселей
- Формат PNG с прозрачным фоном
- Должна быть видна на светлом и темном фоне

## 4.4. Проверка README
README.md должен содержать:
- Описание адаптера
- Инструкции по установке
- Инструкции по настройке
- Список поддерживаемых устройств
- Примеры использования
- Changelog

## 4.5. Онлайн-проверка
После пуша в форк:

1. Открой [adapter-check.iobroker.in](https://adapter-check.iobroker.in/)
2. Введи ссылку на свой репозиторий
3. Убедись, что статус равен `OK`
4. Исправь все найденные проблемы

## 4.6. Проверка зависимостей
Убедись, что все зависимости актуальны:

```bash
npm outdated
npm update
```

## 4.7. Проверка безопасности
```bash
npm audit
npm audit fix
```

## 4.8. Создание Pull Request
Создай Pull Request в [ioBroker.repositories](https://github.com/ioBroker/ioBroker.repositories):

1. Форкни репозиторий `ioBroker.repositories`
2. Добавь свой адаптер в `sources-dist.json` или `sources-dist-community.json`
3. Следуй шаблону Pull Request
4. Добавь скриншоты админки (если есть)
5. Дождись проверки от maintainers

**Пример записи в sources-dist.json:**
```json
"my-adapter": {
    "meta": "https://raw.githubusercontent.com/username/ioBroker.my-adapter/master/io-package.json",
    "icon": "https://raw.githubusercontent.com/username/ioBroker.my-adapter/master/admin/my-adapter.png",
    "type": "general",
    "url": "https://github.com/username/ioBroker.my-adapter"
}
```

## 4.9. Чеклист перед отправкой
- [ ] Все тесты проходят
- [ ] `npm run lint` не выдает ошибок
- [ ] `npx @iobroker/repochecker` проходит
- [ ] adapter-check.iobroker.in показывает OK
- [ ] README.md содержит полную документацию
- [ ] Все переводы добавлены через `npm run translate`
- [ ] Иконка соответствует требованиям
- [ ] `io-package.json` содержит все обязательные поля
- [ ] `protectedNative` настроен для секретов
- [ ] Changelog обновлен
