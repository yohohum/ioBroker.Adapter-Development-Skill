# Этап 3. Архитектура адаптера

## 1. Модульная схема

До реализации создай краткую архитектуру и диаграмму потоков:

- `main` / Adapter subclass;
- configuration validator;
- device discovery/registry;
- transport client;
- protocol codec;
- polling scheduler or push subscriptions;
- ioBroker object/state mapper;
- command dispatcher;
- connection/reachability manager;
- Admin config and message handling.

У каждой части должна быть одна ответственность. Не реализуй весь протокол внутри `on('stateChange')`.

## 2. Жизненный цикл

Опиши последовательность:

1. constructor получает native config;
2. validate config;
3. subscribe на нужные states/messages;
4. connect transport;
5. discover device/features;
6. create/update objects;
7. initial read/sync;
8. start polling/subscriptions;
9. handle command events;
10. handle reconnect and runtime errors;
11. stop: cancel jobs/listeners, close transport.

Сверь сигнатуры lifecycle и `adapter-core` с установленной версией.

## 3. Модель устройств

Для каждого класса устройства определи:

- стабильный unique ID;
- отображаемое имя;
- устройство/каналы/состояния;
- capabilities;
- firmware/API version;
- online state и heartbeat;
- read/write properties;
- доступные команды.

Если устройство не предоставляет стабильный ID, опиши стратегию и риск коллизий.

## 4. Object mapper

Сделай declarative map данных, если datapoints однотипны. Преобразование значений должно быть чистой функцией с тестами. Раздели:

- raw protocol representation;
- normalized domain representation;
- ioBroker object metadata;
- ioBroker state values.

Не создавай object заново на каждом polling цикле, если metadata не меняется.

## 5. Command model

Для каждой команды специфицируй:

- command ID;
- входной тип/диапазон;
- default/units;
- роли;
- protocol operation;
- timeout;
- retries/idempotence;
- confirmation method;
- error propagation;
- state readback behavior.

Не обновляй optimistic `ack:true` без документированного и протестированного основания.

## 6. Multi-instance и multi-device

Явно реши, поддерживается ли:

- несколько экземпляров адаптера;
- несколько устройств в одном экземпляре;
- discovery всего сегмента сети;
- credential per instance или per device;
- независимая ошибка одного устройства без остановки остальных.

Все таймеры, listeners, clients и maps должны быть scoped к экземпляру/устройству и корректно очищаться.

## Критерии завершения

- [ ] Есть компонентная схема и жизненный цикл.
- [ ] Есть список объектных IDs и roles.
- [ ] Есть спецификация команд/подтверждений.
- [ ] Выбран polling/push/hybrid и объяснено почему.
- [ ] Определено поведение reconnect/stop.
- [ ] Определены миграции/обратная совместимость.
