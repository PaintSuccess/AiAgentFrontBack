---
name: shopify-stock-delay-customer-workflow
description: handle PaintAccess Shopify customer stock-delay workflows. use when an order item is out of stock, backordered, delayed by a distributor, expected back in stock later, or the user asks to email the customer, create a Gmail draft, and record a Shopify note about the delay.
---

# Shopify Stock Delay Customer Workflow

Use this skill when a PaintAccess customer needs an order update because products are out of stock or delayed.

## Preconditions

- Identify the Shopify order with `shopify-order-lookup-safe`.
- Confirm affected product/brand and expected restock timing.
- If the order number was misheard or ambiguous, ask for the exact number before using Shopify data.

## Workflow

1. Retrieve order details:
   - order number;
   - customer name/email;
   - affected items;
   - shipping or fulfillment status if relevant.
2. Draft customer email:
   - apologise;
   - state affected product or brand;
   - state expected restock timing;
   - say the order will dispatch when stock arrives;
   - say the customer does not need to do anything;
   - ask the customer to confirm the wait is acceptable.
3. Use `gmail-draft-safe` when the user wants a Gmail draft.
4. Prepare a Shopify note with date, action taken, reason, expected timing, current status, and copy of the email.
5. Use `shopify-order-note-recorder` to write the note when requested and tools are available.

## Reporting

Say separately whether each step was completed:

- email drafted;
- Gmail draft created;
- Shopify note text prepared;
- Shopify note actually written.

Do not say the note was added unless the write succeeds.

See `references/stock-delay-template.md`.
