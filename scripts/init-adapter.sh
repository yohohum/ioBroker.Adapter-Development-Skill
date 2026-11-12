#!/bin/bash
# Скрипт инициализации нового адаптера по стандартам ioBroker

set -e  # Остановка при ошибке

echo "🚀 Создание нового адаптера ioBroker..."
echo ""

# Проверка наличия Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js не установлен. Установите Node.js 18+"
    exit 1
fi

# Проверка версии Node.js
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Требуется Node.js 18 или выше. Установлена версия: $(node -v)"
    exit 1
fi

# Создание адаптера
npx @iobroker/create-adapter@latest

# Находим созданную директорию
ADAPTER_DIR=$(ls -td iobroker.* 2>/dev/null | head -1)

if [ -z "$ADAPTER_DIR" ]; then
    echo "❌ Не удалось найти директорию адаптера"
    exit 1
fi

echo ""
echo "📦 Переход в директорию $ADAPTER_DIR..."
cd "$ADAPTER_DIR"

echo "📦 Установка зависимостей..."
npm install

echo ""
echo "✅ Инициализация переводов..."
if [ ! -f "admin/i18n/en/translations.json" ]; then
    npm run translate to-json
fi

echo ""
echo "🛠️ Сборка проекта..."
npm run build

echo ""
echo "✅ Готово!"
echo ""
echo "Следующие шаги:"
echo "1. Отредактируйте io-package.json"
echo "2. Добавьте логику в src/main.ts"
echo "3. Настройте admin/jsonConfig.json"
echo "4. Запустите отладку: npx @iobroker/dev-server"
echo ""
echo "Полная документация: 02-DEVELOPMENT.md"
