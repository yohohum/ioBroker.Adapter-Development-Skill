# Этап 1: Создание и каркас

## 1.1. Инициализация
Всегда создавай новый адаптер с помощью официального генератора. Не создавай файлы вручную.

```bash
npx @iobroker/create-adapter@latest
```

Следуй интерактивным подсказкам. Обязательно выбери:
- TypeScript (рекомендуется) или JavaScript с проверкой типов
- ESLint и Prettier
- Интеграционные тесты (`@iobroker/testing`)
- GitHub Actions для CI/CD
- React для админки (если нужна сложная UI)

## 1.2. Обязательные зависимости
После создания убедись, что в `package.json` присутствуют:

```json
{
  "dependencies": {
    "@iobroker/adapter-core": "^3.2.0",
    "@iobroker/types": "^7.0.0"
  },
  "devDependencies": {
    "@iobroker/adapter-dev": "^1.4.0",
    "@iobroker/eslint-config": "^2.0.0",
    "@iobroker/testing": "^5.0.0",
    "@alcalzone/release-script": "^3.8.0",
    "eslint": "^9.0.0",
    "prettier": "^3.0.0",
    "typescript": "^5.0.0"
  }
}
```

## 1.3. Базовый класс адаптера (TypeScript)
В главном файле (`src/main.ts`) используй следующий шаблон:

```typescript
import { Adapter, AdapterOptions } from '@iobroker/adapter-core';
import type { ioBroker } from '@iobroker/types';

class MyAdapter extends Adapter {
    public constructor(options: Partial<AdapterOptions> = {}) {
        super({
            ...options,
            name: 'my-adapter',
        });
        
        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    /**
     * Вызывается когда адаптер готов к работе
     */
    private async onReady(): Promise<void> {
        this.log.info('Adapter is ready');
        
        // Создание объектов и состояний
        await this.setObjectNotExistsAsync('testVariable', {
            type: 'state',
            common: {
                name: 'Test Variable',
                type: 'boolean',
                role: 'indicator',
                read: true,
                write: true,
            },
            native: {},
        });

        // Подписка на изменения состояний
        this.subscribeStates('*');

        // Пример чтения конфигурации
        const apiKey = this.config.apiKey;
        if (!apiKey) {
            this.log.warn('API key is not configured');
        }
    }

    /**
     * Вызывается при изменении состояния
     */
    private onStateChange(
        id: string,
        state: ioBroker.State | null | undefined,
    ): void {
        if (state) {
            // Игнорируем ack-состояния (подтверждения от устройства)
            if (state.ack) {
                return;
            }

            this.log.info(`State ${id} changed: ${state.val} (ack = ${state.ack})`);

            // Пример обработки команды
            if (id === `${this.namespace}.testVariable`) {
                // Выполняем действие
                this.setStateAsync(id, { val: state.val, ack: true });
            }
        } else {
            this.log.info(`State ${id} deleted`);
        }
    }

    /**
     * Вызывается при получении сообщений через sendTo
     */
    private onMessage(obj: ioBroker.Message): void {
        if (typeof obj === 'object' && obj.message) {
            if (obj.command === 'send') {
                // Пример ответа
                if (obj.callback) {
                    this.sendTo(obj.from, obj.command, 'Message received', obj.callback);
                }
            }
        }
    }

    /**
     * Вызывается при выгрузке адаптера
     */
    private onUnload(callback: () => void): void {
        try {
            this.log.info('Adapter is shutting down');
            // Закрываем соединения, очищаем таймеры
            callback();
        } catch (e) {
            callback();
        }
    }
}

if (require.main !== module) {
    // Экспортируем для запуска через js-controller
    module.exports = (options: Partial<AdapterOptions> | undefined) =>
        new MyAdapter(options);
} else {
    // Автономный запуск (для отладки)
    new MyAdapter();
}
```

## 1.4. Структура `io-package.json`
Обязательные поля в `io-package.json`:

```json
{
  "common": {
    "name": "my-adapter",
    "version": "0.0.1",
    "news": {
      "0.0.1": {
        "en": "Initial version"
      }
    },
    "title": "My Adapter",
    "titleLang": {
      "en": "My Adapter"
    },
    "desc": {
      "en": "My ioBroker adapter"
    },
    "authors": ["Your Name <your@email.com>"],
    "keywords": ["ioBroker", "smart home", "automation"],
    "license": "MIT",
    "platform": "Javascript/Node.js",
    "main": "build/main.js",
    "icon": "my-adapter.png",
    "enabled": true,
    "extIcon": "https://raw.githubusercontent.com/ioBroker/ioBroker.my-adapter/master/admin/my-adapter.png",
    "readme": "https://github.com/ioBroker/ioBroker.my-adapter/blob/master/README.md",
    "loglevel": "info",
    "mode": "daemon",
    "type": "general",
    "compact": true,
    "connectionType": "cloud",
    "dataSource": "poll",
    "adminUI": {
      "config": "json"
    },
    "dependencies": [
      {
        "js-controller": ">=3.3.22"
      }
    ],
    "globalDependencies": [
      {
        "admin": ">=5.1.13"
      }
    ],
    "protectedNative": ["apiKey", "password"]
  },
  "native": {
    "apiKey": "",
    "pollingInterval": 60
  },
  "objects": [],
  "instanceObjects": []
}
```

**Важно:**
- `protectedNative` - список полей из `native`, которые не должны быть доступны через API
- `main` - путь к скомпилированному JS файлу
- `mode` - режим работы (`daemon`, `once`, `schedule`)
- `compact` - поддержка компактного режима
