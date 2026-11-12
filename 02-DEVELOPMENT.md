# Этап 2: Разработка и отладка

## 2.1. Локальная отладка
Используй `@iobroker/dev-server` для запуска локальной копии ioBroker с горячей перезагрузкой:

```bash
npx @iobroker/dev-server
```

Открой браузер по адресу `http://localhost:8081` для доступа к админке.

## 2.2. Роли состояний (STATE_ROLES)
Агент **ОБЯЗАН** использовать только стандартные роли из официального списка.

### Примеры корректных ролей:

**Датчики (только чтение):**
- `value.temperature` - температура
- `value.humidity` - влажность
- `value.battery` - уровень батареи
- `indicator.reachable` - доступность устройства
- `indicator.maintenance.lowbat` - низкий заряд батареи
- `sensor.motion` - датчик движения

**Управление (чтение/запись):**
- `level.temperature` - установка температуры
- `switch.power` - включение/выключение
- `button.stop` - кнопка остановки
- `level.color.rgb` - цвет в формате RGB
- `level.dimmer` - уровень яркости

**Информация:**
- `info.firmware` - версия прошивки
- `info.ip` - IP адрес
- `info.serial` - серийный номер

**Запрещено использовать устаревшие алиасы:**
- ❌ `action.play` → ✅ `button.play`
- ❌ `indicator.battery` → ✅ `indicator.maintenance.lowbat`
- ❌ `switch.active` → ✅ `switch`

## 2.3. Создание объектов и состояний
Всегда указывай полные метаданные:

```typescript
await this.setObjectNotExistsAsync('device.sensor.temperature', {
    type: 'state',
    common: {
        name: {
            en: 'Temperature',
            de: 'Temperatur',
            ru: 'Температура',
        },
        type: 'number',
        role: 'value.temperature',
        read: true,
        write: false,
        unit: '°C',
        min: -50,
        max: 100,
        def: 20,
    },
    native: {},
});

// Установка значения
await this.setStateAsync('device.sensor.temperature', {
    val: 22.5,
    ack: true,  // Подтверждение от устройства
    q: 0,       // Качество (0 = хорошо)
});
```

### Обязательные поля для состояний:
- `type` - тип данных (`string`, `number`, `boolean`, `object`, `array`)
- `role` - роль из STATE_ROLES
- `read` - можно ли читать
- `write` - можно ли писать
- `name` - имя (объект с переводами)

### Дополнительные поля:
- `unit` - единица измерения
- `min`, `max` - минимальное и максимальное значения
- `def` - значение по умолчанию
- `states` - словарь возможных значений (для перечислений)

## 2.4. Перечисления (common.states)
Для полей с ограниченным набором значений:

```typescript
await this.setObjectNotExistsAsync('device.mode', {
    type: 'state',
    common: {
        name: 'Mode',
        type: 'number',
        role: 'level.mode.thermostat',
        read: true,
        write: true,
        states: {
            0: 'OFF',
            1: 'AUTO',
            2: 'MANUAL',
            3: 'VACATION',
        },
    },
    native: {},
});
```

## 2.5. Конфигурация админки (jsonConfig)
Файл `admin/jsonConfig.json` должен строго соответствовать схеме:

```json
{
  "i18n": true,
  "type": "panel",
  "items": {
    "_header": {
      "type": "header",
      "text": "Connection Settings",
      "size": 3
    },
    "host": {
      "type": "text",
      "label": "Host",
      "tooltip": "Enter the device IP or hostname",
      "sm": 6,
      "required": true,
      "validator": "^[a-zA-Z0-9.-]+$",
      "validatorError": "Invalid hostname format"
    },
    "port": {
      "type": "number",
      "label": "Port",
      "min": 1,
      "max": 65535,
      "default": 8080,
      "sm": 6
    },
    "apiKey": {
      "type": "password",
      "label": "API Key",
      "tooltip": "Enter your API key here",
      "sm": 12,
      "required": true,
      "visible": true
    },
    "_divider1": {
      "type": "divider"
    },
    "_header2": {
      "type": "header",
      "text": "Polling Settings",
      "size": 3
    },
    "pollingInterval": {
      "type": "number",
      "label": "Polling Interval (seconds)",
      "min": 10,
      "max": 3600,
      "default": 60,
      "sm": 6,
      "help": "How often to poll data from the device"
    },
    "enabled": {
      "type": "checkbox",
      "label": "Enable polling",
      "default": true,
      "sm": 6
    }
  }
}
```

### Типы полей:
- `text` - текстовое поле
- `number` - числовое поле
- `password` - пароль (маскируется)
- `checkbox` - чекбокс
- `select` - выпадающий список
- `json` - JSON редактор
- `table` - таблица

## 2.6. Переводы и сборка
Используй `@iobroker/adapter-dev`:

```bash
# Добавить новые строки только в английский JSON
# admin/i18n/en/translations.json
{
  "API Key": "API Key",
  "Host": "Host"
}

# Сгенерировать переводы на все языки
npm run translate

# Собрать TypeScript
npm run build

# Полная сборка (TypeScript + переводы)
npm run translate all
npm run build
```

**Важно:** Никогда не редактируй файлы переводов для других языков вручную. Всегда редактируй только английский файл и запускай `npm run translate`.

## 2.7. Логирование
Используй встроенный логгер:

```typescript
this.log.silly('Debug message with lots of details');
this.log.debug('Debug message');
this.log.info('Informational message');
this.log.warn('Warning message');
this.log.error('Error message');
```

**Правила:**
- `silly` - только для очень подробной отладки
- `debug` - для отладочной информации
- `info` - для обычной информации
- `warn` - для предупреждений (не критично, но требует внимания)
- `error` - для ошибок

## 2.8. Обработка ошибок
Всегда оборачивай асинхронные операции в try-catch:

```typescript
try {
    const data = await this.fetchData();
    await this.setStateAsync('data', { val: data, ack: true });
} catch (error) {
    if (error instanceof Error) {
        this.log.error(`Failed to fetch data: ${error.message}`);
    } else {
        this.log.error('Failed to fetch data: Unknown error');
    }
}
```

## 2.9. Таймеры и интервалы
Всегда очищай таймеры в `onUnload`:

```typescript
private pollingInterval?: NodeJS.Timeout;

private async onReady(): Promise<void> {
    this.pollingInterval = setInterval(() => {
        this.pollDevice();
    }, this.config.pollingInterval * 1000);
}

private onUnload(callback: () => void): void {
    if (this.pollingInterval) {
        clearInterval(this.pollingInterval);
    }
    callback();
}
```

## 2.10. Работа с внешними API
Используй `axios` с обработкой ошибок:

```typescript
import axios from 'axios';

private async fetchData(): Promise<any> {
    try {
        const response = await axios.get(`http://${this.config.host}:${this.config.port}/api/data`, {
            timeout: 5000,
            headers: {
                'Authorization': `Bearer ${this.config.apiKey}`
            }
        });
        return response.data;
    } catch (error) {
        if (axios.isAxiosError(error)) {
            this.log.error(`API error: ${error.message}`);
        }
        throw error;
    }
}
```
