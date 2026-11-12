# Этап 3: Тесты и стиль кода

## 3.1. Конфигурация ESLint и Prettier
Используй **Flat Config** (ESLint 9+). Не используй устаревший `.eslintrc`.

`eslint.config.mjs`:
```javascript
import config from '@iobroker/eslint-config';

export default [...config];
```

`prettier.config.mjs`:
```javascript
import prettierConfig from '@iobroker/eslint-config/prettier.config.mjs';

export default prettierConfig;
```

Для React проектов добавь:
```javascript
import config, { reactConfig } from '@iobroker/eslint-config';

export default [...config, ...reactConfig];
```

## 3.2. Скрипты в package.json
Добавь следующие скрипты:

```json
{
  "scripts": {
    "prebuild": "rimraf build",
    "build": "tsc -p tsconfig.build.json",
    "watch": "tsc -p tsconfig.build.json --watch",
    "test:package": "mocha test/package.js",
    "test:unit": "mocha test/unit.js",
    "test:integration": "mocha test/integration.js",
    "test": "npm run test:package && npm run test:unit && npm run test:integration",
    "lint": "eslint src/**/*.ts",
    "translate": "translate-adapter",
    "release": "release-script"
  }
}
```

## 3.3. Интеграционные тесты
Используй `@iobroker/testing` для проверки запуска адаптера с реальным JS-Controller.

Файл `test/integration.js`:
```javascript
const path = require('path');
const { tests, utils } = require('@iobroker/testing');

tests.integration(path.join(__dirname, '..'), {
    allowedExitCodes: [11], // Если адаптер может завершаться с кодом 11 при отсутствии конфига
    controllerVersion: 'latest',
    
    defineAdditionalTests({ suite }) {
        suite('Test adapter startup', (getHarness) => {
            let harness;
            
            before(() => {
                harness = getHarness();
            });

            it('Should start without errors', async () => {
                await harness.startAdapterAndWait();
                
                // Проверка отсутствия ошибок в логе
                expect(harness.hasLog(/error/i, 'error')).to.be.false;
            });

            it('Should create required objects', async () => {
                await harness.startAdapterAndWait();
                
                // Проверка создания объектов
                const obj = await harness.objects.getObject('my-adapter.0.info.connection');
                expect(obj).to.exist;
                expect(obj.common.type).to.equal('boolean');
                expect(obj.common.role).to.equal('indicator.connected');
            });

            it('Should respond to sendTo', async () => {
                await harness.startAdapterAndWait();
                
                const response = await new Promise(resolve => {
                    harness.sendTo('my-adapter.0', 'testCommand', { test: 'data' }, resolve);
                });
                
                expect(response).to.exist;
                expect(response.error).to.not.exist;
            });

            it('Should handle state changes', async () => {
                await harness.startAdapterAndWait();
                
                // Создаем тестовое состояние
                await harness.states.setState('my-adapter.0.testVariable', {
                    val: true,
                    ack: false
                });
                
                // Ждем обработки
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                // Проверяем, что состояние было подтверждено
                const state = await harness.states.getState('my-adapter.0.testVariable');
                expect(state).to.exist;
                expect(state.ack).to.be.true;
            });
        });

        suite('Test with invalid config', (getHarness) => {
            let harness;
            
            before(() => {
                harness = getHarness();
            });

            it('Should log warning when API key is missing', async () => {
                // Устанавливаем пустую конфигурацию
                await harness.changeAdapterConfig('my-adapter', {
                    native: {
                        apiKey: '',
                        host: 'localhost'
                    }
                });
                
                await harness.startAdapterAndWait();
                
                // Проверяем наличие предупреждения в логе
                expect(harness.hasLog(/API key is not configured/, 'warn')).to.be.true;
            });
        });
    }
});
```

## 3.4. Проверка пакетов
Файл `test/package.js`:
```javascript
const path = require('path');
const { tests } = require('@iobroker/testing');

// Проверяем структуру package.json и io-package.json
tests.packageFiles(path.join(__dirname, '..'));
```

## 3.5. Модульные тесты (Unit tests)
Если нужны модульные тесты без запуска контроллера:

Файл `test/unit.js`:
```javascript
const path = require('path');
const { tests, utils } = require('@iobroker/testing');
const { expect } = require('chai');

const { database, adapter } = utils.unit.createMocks({
    appName: 'my-adapter',
    adapterName: 'my-adapter'
});

const { assertObjectExists, assertStateExists, assertStateHasValue } = 
    utils.unit.createAsserts(database, adapter);

describe('Test MyAdapter', () => {
    beforeEach(() => {
        database.clear();
    });

    it('Should create objects correctly', () => {
        // Публикуем тестовый объект
        database.publishObject({
            _id: 'my-adapter.0.info.connection',
            type: 'state',
            common: {
                name: 'Connection',
                type: 'boolean',
                role: 'indicator.connected',
                read: true,
                write: false
            },
            native: {}
        });

        assertObjectExists('my-adapter.0.info.connection');
    });

    it('Should handle state changes', () => {
        // Публикуем состояние
        database.publishState('my-adapter.0.test', {
            val: 42,
            ack: true
        });

        assertStateExists('my-adapter.0.test');
        assertStateHasValue('my-adapter.0.test', 42);
    });
});
```

## 3.6. Запуск тестов
```bash
# Все тесты
npm test

# Только проверка пакетов
npm run test:package

# Только интеграционные тесты
npm run test:integration

# Только модульные тесты
npm run test:unit
```

## 3.7. Покрытие кода
Добавь `nyc` для измерения покрытия:

```json
{
  "devDependencies": {
    "nyc": "^15.1.0"
  },
  "scripts": {
    "coverage": "nyc npm test"
  },
  "nyc": {
    "include": ["src/**/*.ts"],
    "exclude": ["test/**", "**/*.d.ts"],
    "reporter": ["text-summary", "html"],
    "all": true
  }
}
```

## 3.8. Тестирование параллельных запусков
Если нужно запускать тесты параллельно на одной машине:

```bash
export IOBROKER_TESTING_OBJECTS_PORT=19001
export IOBROKER_TESTING_STATES_PORT=19000
npm run test:integration
```

Или в коде:
```javascript
tests.integration(path.join(__dirname, '..'), {
    ports: {
        objects: 19001,
        states: 19000
    }
});
```
