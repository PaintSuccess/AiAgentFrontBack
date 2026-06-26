# Shopify PO / Customer Email / Order Notes Flow Summary

Дата контекста чата: 4 июня 2026  
Основной заказ: Shopify order `#44478`  
Клиент: Michael Briffa  
Поставщик / бренд: iQuip / Timbabuild  
Магазин: PaintAccess

## 1. Главная цель

Целью было проверить, можно ли прямо из чата работать с заказами Shopify и строить операционный workflow для PaintAccess:

1. Найти заказ в Shopify по номеру заказа.
2. Вытащить данные заказа: товары, SKU, количество, клиент, адрес доставки.
3. Определить поставщика по товарам / бренду.
4. Сформировать Purchase Order для поставщика.
5. Подготовить письмо клиенту при проблеме со стоком.
6. Создать Gmail draft для клиента.
7. Добавить заметку в Shopify order notes с копией письма.

## 2. Flow 1: Поиск заказа Shopify и подготовка PO

### Что пользователь хотел сделать

Пользователь спросил, можно ли назвать номер заказа Shopify, чтобы ассистент нашел заказ и прямо здесь в чате подготовил PO.

### Что было сделано

Сначала номер заказа был распознан неверно как `#43478`, но пользователь уточнил, что правильный номер — `#44478`.

После уточнения заказ `#44478` был найден в Shopify. Из заказа были использованы следующие данные:

- товары;
- SKU;
- количество;
- адрес доставки;
- имя клиента;
- определение поставщика / бренда.

### Найденные товары

1. `iQuip Timbabuild EWS Wood Primer`  
   SKU: `38EWS`  
   Quantity: `1`

2. `iQuip Timbabuild EHB60 Epoxy Filler`  
   SKU: `38EHB60`  
   Quantity: `1`

### Адрес доставки

Michael Briffa  
20 Norman Terrace  
Forestville SA 5035  
Australia

### Рабочий результат

Был подготовлен PO-драфт для поставщика iQuip / Timbabuild:

```text
Subject: Purchase Order for PaintAccess – Order #44478

Hi iQuip Team,

Please prepare the following order for PaintAccess.

Customer order: #44478

1. iQuip Timbabuild EWS Wood Primer
SKU: 38EWS
Quantity: 1

2. iQuip Timbabuild EHB60 Epoxy Filler
SKU: 38EHB60
Quantity: 1

Delivery address:

Michael Briffa
20 Norman Terrace
Forestville SA 5035
Australia

Please confirm availability and send through order confirmation.

Kind regards,
PaintAccess
```

## 3. Flow 2: Customer delay email по stock issue

### Что пользователь хотел сделать

Пользователь попросил написать клиенту по заказу `#44478`, что товары Timbabuild сейчас отсутствуют в наличии, дистрибьютор ожидает поступление примерно через неделю, и заказ будет отправлен сразу после поступления. Также нужно было сообщить, что клиенту ничего делать не нужно, и попросить подтвердить, что ожидание подходит.

### Что было сделано

Был подготовлен customer email на английском языке.

### Рабочий результат: Gmail draft

Gmail draft был успешно создан для клиента.

Текст письма:

```text
Subject: Update on your PaintAccess order #44478

Hi Michael,

Thank you for your order with PaintAccess.

We sincerely apologise, but we currently do not have the Timbabuild products in stock. Our distributor expects to have them back in stock in approximately one week, and we will dispatch your order as soon as the stock becomes available.

You do not need to do anything at this stage. Please let us know if this is okay with you.

Thank you for your patience and understanding.

Kind regards,
PaintAccess
```

## 4. Flow 3: Shopify order note с копией email

### Что пользователь хотел сделать

Пользователь хотел, чтобы к заказу Shopify была добавлена заметка, где указано, что клиенту отправлен email о задержке, и чтобы в заметку была вставлена копия письма.

### Подготовленный текст note

```text
04/06/2026 - Customer emailed regarding stock delay for order #44478. Advised that Timbabuild products are currently out of stock and distributor expects stock in approximately 1 week. Customer informed that order will be dispatched immediately upon stock arrival and no action is required from their side. Awaiting customer confirmation.

Copy of email:

Hi Michael,

Thank you for your order with PaintAccess.

We sincerely apologise, but we currently do not have the Timbabuild products in stock. Our distributor expects to have them back in stock in approximately one week, and we will dispatch your order as soon as the stock becomes available.

You do not need to do anything at this stage. Please let us know if this is okay with you.

Thank you for your patience and understanding.

Kind regards,
PaintAccess
```

### Неуспешные попытки

Было несколько попыток добавить note напрямую в Shopify, но в тот момент доступный Shopify write-инструмент для notes не был виден или не был доступен в сессии. Поэтому ассистент не смог фактически записать note в заказ.

Позже пользователь сказал, что Shopify подключен, но на момент ответа ассистент всё еще не видел доступного инструмента для записи notes и предложил вставить note вручную.

### Важное уточнение

В дальнейшем стал доступен Shopify connector с GraphQL mutation, который потенциально может решить задачу добавления notes, если использовать правильный Shopify Admin API mutation.

Рабочий путь для будущей реализации:

1. Получить заказ через `Shopify.get-order` или GraphQL query.
2. Узнать точный GraphQL mutation для добавления order note / order edit / staff note через `Shopify.graphql_schema` и Shopify docs search.
3. Провалидировать GraphQL через `Shopify.validate_graphql_codeblocks`.
4. Выполнить mutation через `Shopify.graphql_mutation`.

Важно: в чате note не был подтвержденно добавлен в Shopify. Успешно был создан только Gmail draft и подготовлен текст note.

## 5. Что реально сработало

### 5.1. Shopify order lookup

Сработал поиск заказа Shopify по правильному номеру `#44478`.

Результат: удалось получить данные заказа и подготовить PO.

### 5.2. PO drafting

Сработала ручная логика формирования PO из заказа:

- определить поставщика по бренду / товару;
- очистить и отобразить SKU;
- включить quantity;
- включить delivery address;
- сформировать supplier-facing email.

### 5.3. Gmail draft

Сработало создание Gmail draft для клиента.

Результат: письмо клиенту было создано как драфт с темой `Update on your PaintAccess order #44478`.

### 5.4. Подготовка Shopify note text

Сработала подготовка полного текста note, включая копию email.

Результат: текст можно вставить вручную или использовать для будущей автоматической записи через Shopify GraphQL mutation.

## 6. Что не сработало

### 6.1. Первый поиск заказа

Первая попытка поиска была по неверно распознанному номеру `#43478`. Shopify не нашел заказ.

Причина: пользовательский номер был неоднозначно произнесен / распознан.

Рабочее решение: пользователь уточнил правильный номер `#44478`, после чего заказ был найден.

### 6.2. Shopify notes write

Попытка добавить note в Shopify не сработала в тот момент.

Причина: в доступных инструментах не было явно доступного write-action для добавления order notes. Ассистент также сначала считал, что доступен только read-access или Gmail.

Рабочий обходной путь: подготовить полный note text для ручной вставки.

Потенциально рабочий автоматический путь: использовать Shopify GraphQL mutation после проверки schema и validation.

## 7. Построенные операционные workflows

### Workflow A: Shopify order → PO draft

1. Пользователь дает order number.
2. Ассистент ищет заказ в Shopify.
3. Ассистент читает line items.
4. Ассистент определяет supplier.
5. Ассистент формирует PO email.
6. Пользователь может отправить PO поставщику или попросить создать Gmail draft.

Статус: рабочий.

### Workflow B: Shopify order → Customer stock delay email

1. Пользователь сообщает, что товара нет в наличии.
2. Ассистент готовит письмо клиенту.
3. Ассистент создает Gmail draft.
4. Пользователь проверяет и отправляет.

Статус: рабочий.

### Workflow C: Customer email → Shopify note

1. Ассистент берет текст customer email.
2. Формирует internal note для заказа.
3. В note добавляется summary + copy of email.
4. Note вставляется в Shopify order.

Статус: частично рабочий.

Сработала подготовка note text. Автоматическая запись note в Shopify не была подтвержденно выполнена.

## 8. Рекомендации для следующего шага автоматизации

Чтобы сделать процесс более надежным и полностью автоматическим, стоит закрепить следующие правила:

### 8.1. Правила поиска заказа

- Всегда уточнять order number в формате `#44478`, если номер был продиктован голосом или содержит точки / паузы.
- Для Shopify использовать `Shopify.get-order` с номером заказа или GID.

### 8.2. Правила PO

- Supplier определяется по vendor / product title / SKU pattern.
- Для Timbabuild товары идут к iQuip.
- PO должен включать:
  - subject;
  - greeting supplier;
  - PaintAccess order number;
  - product name;
  - SKU;
  - quantity;
  - delivery address;
  - request for stock confirmation.

### 8.3. Правила customer delay email

Delay email должен включать:

- apology;
- что именно out of stock;
- expected restock timing;
- что заказ будет отправлен сразу после поступления;
- что клиенту ничего не нужно делать;
- просьбу подтвердить, что ожидание подходит.

### 8.4. Правила Shopify note

Shopify note должен включать:

- дату;
- action taken;
- reason for customer contact;
- expected restock timing;
- current status / awaiting customer confirmation;
- copy of customer email.

## 9. Итог

За время чата был фактически построен рабочий semi-automated workflow для PaintAccess:

`Shopify order → supplier identification → PO draft → customer delay email → Gmail draft → Shopify note text`

Полностью рабочими оказались:

- поиск заказа Shopify после правильного номера;
- извлечение данных заказа;
- подготовка PO;
- создание Gmail draft;
- подготовка текста Shopify note.

Не был подтвержденно выполнен:

- автоматический write-back Shopify note в order notes.

Самый надежный следующий технический путь для Shopify notes — использовать Shopify GraphQL mutation через официальный workflow: schema lookup → validation → mutation execution.
