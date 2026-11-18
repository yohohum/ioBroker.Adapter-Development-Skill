# Этап 2. Создание каркаса

## Цель

Создать официальный каркас и не потерять настройки, которые добавляет генератор.

## 1. Проверить окружение

```bash
node --version
npm --version
```

Сверь Node/npm с текущим README `@iobroker/create-adapter` и диапазоном проекта. Не считай требование генератора равным минимальному Node.js для самого адаптера/контроллера.

## 2. Запустить генератор

```bash
npx @iobroker/create-adapter@latest
```

Работай в каталоге, где должен появиться проект. Не используй каталог с пробелами, если текущий генератор сообщает о таком ограничении. Изучи интерактивные вопросы и выбери:

- Adapter (а не только VIS widget);
- JavaScript/TypeScript — согласно требованиям проекта, по умолчанию предпочитай TypeScript;
- Admin UI jsonConfig или React — по результатам discovery;
- актуальный ESLint/Prettier options;
- licence;
- тесты и GitHub Actions, если доступны в генераторе.

Не придумывай CLI flags; смотри текущий `--help`.

## 3. Проверить созданные файлы

До редактирования:

```bash
find . -maxdepth 3 -type f | sort
cat package.json
cat io-package.json
```

Изучи generated `scripts`, build paths, `files`, `main`, `types`, tsconfig, ESLint, Mocha, test, Admin и workflow.

Не заменяй существующие команды упрощёнными командами по памяти. Если требуется добавить скрипт, сохрани совместимость с остальными scripts.

## 4. Установить зависимости

```bash
npm install
```

Коммить lock-файл. Проверь версии и `engines` ключевых зависимостей:

```bash
npm ls @iobroker/adapter-core @iobroker/types @iobroker/adapter-dev @iobroker/testing @iobroker/eslint-config
```

Если какой-либо пакет не используется шаблоном, не добавляй его автоматически. Runtime packages помещай в `dependencies`; compile/test/lint/type packages — в `devDependencies`, если проект/пакет не документирует иной способ.

Для TypeScript проверь, что `@iobroker/types` действительно подключён: по README пакета он не регистрируется автоматически, поэтому добавь `"@iobroker/types"` в `compilerOptions.types` либо импортируй `@iobroker/types` в entry point.

Используй `@iobroker/eslint-config` и ESLint-конфигурацию, созданную актуальным генератором. Не заменяй её самодельной конфигурацией без проверки официального README.

Если применяется `@iobroker/adapter-dev`, сохрани `translate-adapter` и `build-adapter`. Задай canonical `npm run build` так, чтобы он без дополнительных аргументов выполнял **полную сборку данного проекта** (например, TypeScript only, React only или оба направления согласно установленной версии adapter-dev). Это необходимо для воспроизводимого CI. Для ручной частичной сборки команды adapter-dev могут принимать `typescript`, `react` или `all`; проверь точный синтаксис установленной версии.

## 5. Базовая проверка

До реализации:

```bash
npm run build
npm run lint
npm run test:package
npm run test:integration
```

Запускай только существующие в generated project скрипты на первом baseline этапе; если названия отличаются, зафиксируй их в заметках. Для завершённого проекта обеспечь эквивалентные mandatory scripts.

## Критерии завершения

- [ ] Сгенерирован официальный каркас.
- [ ] Все generated файлы и scripts изучены.
- [ ] Dependencies установлены, lock-file создан.
- [ ] Базовая сборка и доступные тесты прошли.
- [ ] Условия выбора Node/controller/Admin зафиксированы.
- [ ] Нет изменений сгенерированной структуры без причины.
