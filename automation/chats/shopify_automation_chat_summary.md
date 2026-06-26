# Summary: Shopify Order → Supplier Purchase Order Automation

## Context

В чате обсуждалась возможность автоматизировать процесс обработки новых заказов из Shopify: при появлении нового заказа система должна определить поставщика для каждого товара, сформировать Purchase Order и отправить его нужному supplier через Gmail.

Главный вопрос был: **можно ли сделать так, чтобы Shopify автоматически проверял новый заказ, понимал supplier, создавал Purchase Order и отправлял его нужному человеку по email?**

Ответ: **да, это возможно**, но есть разница между полуавтоматическим режимом внутри ChatGPT и полностью автоматическим workflow через внешнюю интеграцию.

---

## Главная цель автоматизации

Цель — построить процесс, при котором:

1. В Shopify появляется новый заказ.
2. Система читает товары внутри заказа.
3. Для каждого товара определяется supplier.
4. Если в заказе товары от одного supplier — создаётся один Purchase Order.
5. Если в заказе товары от разных suppliers — заказ разделяется на несколько Purchase Orders.
6. Для каждого supplier применяется своя логика SKU, количества, email-адресов и текста письма.
7. Purchase Order отправляется через Gmail нужному поставщику.
8. Заказ в Shopify помечается как обработанный, например тегом или note: `PO sent`, `PO sent - IQuip`, etc.
9. При необходимости сохраняется копия письма или PO.

---

## Обсуждавшиеся flows

### Flow 1: Полуавтоматический workflow через ChatGPT

Этот вариант возможен, если Shopify и Gmail подключены к ChatGPT.

Примерный процесс:

1. Пользователь просит: “проверь последние заказы и сделай PO”.
2. ChatGPT получает данные из Shopify.
3. ChatGPT анализирует line items заказа.
4. ChatGPT определяет supplier по SKU, vendor, product title, tags или заранее заданной таблице правил.
5. ChatGPT формирует Purchase Order.
6. ChatGPT готовит email supplier-у.
7. При подключенном Gmail ChatGPT может помочь отправить письмо или подготовить его к отправке.

### Что работает в этом варианте

- Проверка конкретного заказа.
- Анализ товаров в заказе.
- Разделение товаров по supplier.
- Подготовка текста Purchase Order.
- Подготовка email для supplier.
- Потенциальная отправка через Gmail, если connector доступен и разрешён.

### Ограничение

ChatGPT в обычном чате **не сидит постоянно в фоне** и не ждёт новый заказ сам по себе. Такой вариант требует ручного запуска командой пользователя.

---

### Flow 2: Shopify Flow + Gmail / Email integration / Make / Zapier

Это быстрый no-code или low-code вариант.

Примерный workflow:

```text
New paid order in Shopify
→ check line items / SKU / vendor / tags
→ determine supplier
→ split order by supplier
→ generate supplier-specific Purchase Order
→ send email through Gmail / SMTP / Make / Zapier
→ add Shopify tag or note, e.g. PO sent - IQuip
```

### Что работает в этом варианте

- Автоматический запуск при новом заказе.
- Использование Shopify Flow или webhook-триггера.
- Передача данных в Make.com или Zapier.
- Отправка email через Gmail или SMTP.
- Обновление заказа в Shopify тегом или заметкой.

### Ограничения

Этот вариант может стать сложным, если правила supplier-ов нестандартные:

- разные правила обработки SKU;
- split order по нескольким supplier-ам;
- особые тексты email для разных поставщиков;
- bundle SKU;
- suffix removal;
- специфические исключения по брендам и поставщикам.

---

### Flow 3: Кастомное приложение / middleware

Это самый надёжный вариант для сложной логики.

Примерная архитектура:

```text
Shopify webhook: orders/create или orders/paid
→ custom backend / middleware
→ supplier mapping rules
→ SKU transformation rules
→ supplier-specific PO generation
→ Gmail API / SMTP email sending
→ Shopify Admin API update order tags/notes/metafields
```

### Что работает в этом варианте

- Полностью автоматический запуск.
- Гибкая обработка заказов.
- Разделение одного заказа на несколько supplier-specific Purchase Orders.
- Применение сложных правил SKU и quantity.
- Отправка писем через Gmail API.
- Сохранение логов и статусов.
- Добавление тегов, заметок или metafields обратно в Shopify.

### Почему этот путь был признан наиболее правильным

Для бизнеса с большим количеством supplier-specific правил кастомная логика надёжнее, чем простой no-code сценарий. В чате упоминались поставщики и правила, которые могут требовать отдельной обработки:

- Oldfields
- Soudal
- Norglass
- Opus
- IQuip / iquip
- удаление суффиксов вроде `-D1`, `-D2`
- преобразование кодов вроде `P3`, `P4` в quantity
- разные payment notes / email text для разных suppliers
- разделение заказа на supplier-specific Purchase Orders

---

## Операции, которые обсуждались

### 1. Получение заказа из Shopify

Система должна получать новый заказ либо:

- через ручной запрос в ChatGPT;
- через Shopify Flow;
- через Shopify webhook `orders/create` или `orders/paid`;
- через Make.com / Zapier Shopify trigger;
- через кастомное приложение.

### 2. Анализ line items

Для каждого товара нужно читать:

- SKU;
- product title;
- vendor;
- tags;
- variant title;
- quantity;
- возможно product metafields.

### 3. Определение supplier

Supplier может определяться по:

- SKU prefix / suffix;
- vendor;
- product tags;
- product type;
- заранее созданной supplier mapping table;
- отдельным исключениям.

### 4. Преобразование SKU

Для некоторых supplier-ов могут потребоваться правила нормализации SKU, например:

- убрать `-D1`, `-D2`;
- интерпретировать `P3`, `P4` как quantity/pack logic;
- менять SKU формат перед отправкой supplier-у;
- исключать внутренние Shopify suffixes из supplier-facing PO.

### 5. Создание Purchase Order

PO должен содержать:

- supplier name;
- customer/order reference;
- Shopify order number;
- product SKU;
- supplier-facing SKU;
- product description;
- quantity;
- delivery/shipping address, если supplier отправляет напрямую;
- notes/payment instructions, если нужно;
- дату и номер PO.

### 6. Отправка email через Gmail

Email должен уходить конкретному supplier-у.

Пример логики:

```text
if supplier = IQuip → send to IQuip contact
if supplier = Oldfields → send to Oldfields contact
if supplier = Soudal → send to Soudal contact
if supplier = Norglass → send to Norglass contact
```

Email может содержать:

- PO в теле письма;
- PO как PDF/CSV/HTML attachment;
- order reference;
- shipping details;
- supplier-specific notes.

### 7. Обновление Shopify заказа

После отправки PO система должна пометить заказ, чтобы не отправить PO повторно.

Варианты:

- добавить tag: `PO sent`;
- добавить tag: `PO sent - SupplierName`;
- добавить order note;
- записать статус в metafield;
- сохранить ссылку на отправленный email или PO.

---

## Неуспешные или ограниченные попытки / ограничения

### 1. ChatGPT не может сам постоянно мониторить Shopify в фоне

В рамках обычного чата ChatGPT не запускает постоянный background worker, который будет сам ждать новые заказы и реагировать без внешней автоматизации.

Рабочий обход:

- использовать Shopify Flow;
- использовать Make.com / Zapier;
- использовать Shopify webhook;
- использовать кастомный backend.

### 2. Простая no-code автоматизация может не выдержать сложных правил

Make.com, Zapier или Shopify Flow могут быстро запустить базовый процесс, но они менее удобны, если нужно:

- много supplier-specific исключений;
- сложная нормализация SKU;
- split order на несколько PO;
- разные templates писем;
- контроль повторной отправки;
- логирование ошибок.

Рабочий обход:

- начинать с Make.com/Zapier для MVP;
- затем перенести правила в кастомное middleware, если логика станет сложной.

### 3. Нужна таблица правил supplier mapping

Без заранее описанных правил система не сможет стабильно определять supplier.

Рабочий обход:

Создать mapping table, например:

| Rule type | Example | Supplier |
|---|---|---|
| Vendor | Oldfields | Oldfields |
| Vendor | Soudal | Soudal |
| SKU prefix | IQ- | IQuip |
| Tag | supplier:norglass | Norglass |
| Product type | Opus item | Opus |

---

## Рабочие пути, найденные в чате

### Рабочий путь A: Ручной запуск через ChatGPT

Подходит, если нужно быстро проверять заказы и создавать PO по команде.

```text
User asks ChatGPT to check orders
→ ChatGPT reads Shopify order
→ determines supplier
→ prepares PO
→ prepares Gmail email
```

Плюсы:

- быстро начать;
- удобно тестировать правила;
- не требует полноценной разработки сразу.

Минусы:

- не полностью автоматический;
- требует ручного запуска.

---

### Рабочий путь B: Shopify Flow + Make/Zapier + Gmail

Подходит как MVP автоматизации.

```text
Shopify paid order trigger
→ Make/Zapier scenario
→ supplier mapping
→ generate PO
→ Gmail send email
→ update Shopify order tag/note
```

Плюсы:

- быстрее всего запустить;
- меньше кода;
- понятный визуальный workflow.

Минусы:

- сложнее поддерживать большое количество правил;
- может быть неудобно для advanced SKU transformations.

---

### Рабочий путь C: Shopify webhook + custom middleware + Gmail API

Подходит как наиболее правильное long-term решение.

```text
Shopify webhook orders/paid
→ custom backend
→ supplier rules engine
→ PO generator
→ Gmail API sender
→ Shopify Admin API status update
```

Плюсы:

- максимально гибко;
- хорошо подходит для supplier-specific logic;
- можно логировать ошибки;
- можно предотвратить дубли;
- можно масштабировать.

Минусы:

- требует разработки;
- нужно хранить credentials и supplier mapping;
- нужно поддерживать backend.

---

## Рекомендованная стратегия

Лучший практический путь:

1. **Сначала описать правила supplier mapping.**
   - supplier name;
   - supplier email;
   - matching rule: vendor/SKU/tag/product type;
   - SKU transformations;
   - email template;
   - PO format.

2. **Протестировать вручную через ChatGPT на нескольких заказах.**
   - проверить, правильно ли определяется supplier;
   - проверить split по нескольким supplier-ам;
   - проверить формат PO;
   - проверить email templates.

3. **Собрать MVP через Make.com или Zapier.**
   - Shopify trigger;
   - supplier mapping table;
   - Gmail send email;
   - Shopify tag update.

4. **Если правил станет много — перейти на custom middleware.**
   - webhook;
   - rules engine;
   - PO generator;
   - Gmail API;
   - Shopify Admin API.

---

## Итог

Полная автоматизация Shopify order → supplier Purchase Order → Gmail email **реальна и технически выполнима**.

Наиболее рабочие варианты:

- для быстрого старта: **ChatGPT + ручной запуск**;
- для MVP: **Shopify Flow / Make / Zapier + Gmail**;
- для стабильной production-автоматизации: **Shopify webhook + custom middleware + Gmail API + Shopify Admin API**.

Главное ограничение: обычный ChatGPT-чат сам по себе не является постоянным фоновым процессом. Для полной автоматизации нужен внешний trigger: Shopify Flow, Make/Zapier или кастомный webhook backend.
