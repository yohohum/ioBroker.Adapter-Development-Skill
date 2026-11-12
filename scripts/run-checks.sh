#!/bin/bash
# Скрипт предрелизных проверок для ИИ-агента

set -e  # Остановка при первой ошибке

echo "🔍 Запуск предрелизных проверок..."
echo ""

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Функция для вывода статуса
print_status() {
    if [ $1 -eq 0 ]; then
        echo -e "${GREEN}✓${NC} $2"
    else
        echo -e "${RED}✗${NC} $2"
        exit 1
    fi
}

echo "📋 Этап 1: Проверка стиля кода"
echo "--------------------------------"
npm run lint
print_status $? "Линтер пройден"
echo ""

echo "📦 Этап 2: Проверка структуры пакетов"
echo "--------------------------------------"
npm run test:package
print_status $? "Структура пакетов корректна"
echo ""

echo "🧪 Этап 3: Запуск модульных тестов"
echo "-----------------------------------"
if [ -f "test/unit.js" ]; then
    npm run test:unit
    print_status $? "Модульные тесты пройдены"
else
    echo -e "${YELLOW}⚠${NC} Модульные тесты не найдены (пропущено)"
fi
echo ""

echo "🔬 Этап 4: Запуск интеграционных тестов"
echo "----------------------------------------"
npm run test:integration
print_status $? "Интеграционные тесты пройдены"
echo ""

echo "🕵️ Этап 5: Запуск repochecker"
echo "------------------------------"
npx @iobroker/repochecker
print_status $? "Repochecker пройден"
echo ""

echo "🔒 Этап 6: Проверка безопасности"
echo "---------------------------------"
npm audit --audit-level=moderate
print_status $? "Проверка безопасности пройдена"
echo ""

echo "✅ Все проверки пройдены успешно!"
echo ""
echo "Адаптер готов к релизу."
echo "Следуйте инструкциям в 05-RELEASE.md"
