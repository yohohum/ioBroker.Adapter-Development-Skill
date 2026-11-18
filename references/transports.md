# Сетевые транспорты и устойчивость драйвера

Выбирай транспорт на основании реальной документации устройства. Не добавляй сразу несколько способов связи «на всякий случай».

## 1. Общая архитектура

Разделяй слои:

1. Adapter lifecycle / ioBroker integration.
2. Device manager (обнаружение, registry, маршрутизация команд).
3. Transport client (TCP/UDP/serial/MQTT/WebSocket/HTTP и т. д.).
4. Protocol codec (кодирование/декодирование пакетов, валидация ответов).
5. Domain model (нормализованные данные устройства).
6. ioBroker object/state mapper.

Протокольный код должен быть по возможности независим от `Adapter`, чтобы его можно было покрыть unit-тестами.

## 2. Соединение

Определи явную конечную машину состояний, например:

`stopped → connecting → connected → reconnecting → stopped`.

Определи допустимые переходы и события. Не создавай несколько параллельных клиентов к одному устройству без необходимости.

Обязательные случаи:

- DNS/host not found;
- connection refused;
- connect timeout;
- socket close/error;
- auth failure;
- malformed response;
- partial response;
- device offline;
- reconnect;
- adapter stop во время connect/request;
- изменение настроек подключения во время работы.

## 3. Retry и backoff

Используй ограниченный exponential backoff с верхним пределом и jitter, чтобы несколько экземпляров не создавали synchronized retry storm. Разделяй временные ошибки (timeout, network reset) и постоянные ошибки (неверный пароль, несовместимая версия протокола). Не повторяй автоматически неидемпотентную команду, если неясно, была ли она выполнена устройством.

Документируй:

- таймаут соединения;
- таймаут запроса;
- количество/интервал повторов;
- верхний предел задержки;
- поведение при auth/protocol errors;
- условие признания устройства online/offline.

## 4. Polling

Не используй `setInterval(async () => ...)` без защиты от наложения Promise.

Предпочтительный шаблон — последовательный цикл с отменой или планирование следующего запуска только после завершения предыдущего:

```typescript
private pollTimer: NodeJS.Timeout | undefined;
private polling = false;
private stopping = false;

private scheduleNextPoll(delayMs: number): void {
    if (this.stopping) return;
    this.pollTimer = setTimeout(() => void this.pollOnce(), delayMs);
}

private async pollOnce(): Promise<void> {
    if (this.stopping || this.polling) return;
    this.polling = true;
    try {
        await this.pollDevice();
    } catch (error) {
        this.log.warn(`Polling failed: ${this.formatError(error)}`);
    } finally {
        this.polling = false;
        this.scheduleNextPoll(this.config.pollingIntervalMs);
    }
}
```

Этот пример нужно адаптировать: убедись, что `pollingIntervalMs` имеет безопасное положительное значение, `formatError` не раскрывает секреты, stop отменяет timer, а сетевые операции можно завершить/прервать. Для многих устройств лучше использовать `AbortController` или транспортную отмену.

## 5. Push-соединение

Для MQTT/WebSocket/TCP push:

- ограничивай размер входящего сообщения;
- проверяй schema/тип;
- обрабатывай дубликаты и out-of-order, если протокол допускает;
- обновляй `ack:true` только от реальной телеметрии;
- при disconnect выставляй корректный connection/reachability state;
- переподписывайся после reconnect;
- не создавай повторные listeners после каждого reconnect.

## 6. TCP/UDP/Serial

Для потокового транспорта TCP помни, что TCP — поток байтов: один `data` event не гарантирует один пакет. Реализуй framing (length prefix, delimiter, fixed frame или protocol-defined framing), поддержку разбиения и склейки пакетов и лимит буфера.

Для UDP учитывай потерю, дублирование и переупорядочивание пакетов.

Для Serial документируй baud rate, data bits, parity, stop bits, flow control и поведение reconnect.

## 7. MQTT

- Явно задавай client ID и namespace-изоляцию.
- Документируй QoS, retain, clean start/session, keepalive и wildcard subscriptions.
- Валидируй топики и payload.
- Не предполагается, что QoS 1/2 автоматически означает выполнение бизнес-команды устройством.
- Отключай подписки и закрывай клиент при stop.

## 8. HTTP/REST

- Используй connect/request timeout.
- Проверяй HTTP status и структуру ответа.
- Не скрывай 4xx/5xx как пустое значение.
- Обновляй токен с защитой от параллельного refresh.
- Обрабатывай rate limits (например, `Retry-After`) и документируй частоту опроса.
- Не включай credentials в URL/логи.

## 9. Stop lifecycle

При завершении адаптера:

1. Запрети планирование новых операций.
2. Отмени таймеры и scheduler jobs.
3. Отпишись от событий/топиков.
4. Отмени или дождись активных запросов в пределах разумного timeout.
5. Закрой сокеты/клиенты/serial ports.
6. Освободи listeners.
7. Заверши stop callback/Promise только после cleanup.

Проверь повторный start и stop, если среда тестирования/контроллер может запрашивать такой сценарий.
