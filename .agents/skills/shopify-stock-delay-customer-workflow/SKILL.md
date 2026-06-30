---
name: shopify-stock-delay-customer-workflow
description: handle PaintAccess Shopify customer stock-delay workflows. use when an order item is out of stock, backordered, delayed by a distributor, expected back in stock later, or the user asks to email the customer through Shopify native email or Gmail, and record a Shopify note about the delay.
---

# Shopify Stock Delay Customer Workflow

Use this skill when a PaintAccess customer needs an order update because products are out of stock or delayed.

## Preconditions

- Identify the Shopify order with `shopify-order-lookup-safe`.
- Confirm affected product/brand and expected restock timing.
- If the order number was misheard or ambiguous, ask for the exact number before using Shopify data.

## Workflow

1. Retrieve order details with `shopify_get_order`:
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
3. If the user approved sending a customer update, prefer `shopify_send_customer_email` with `delivery_method: "order_invoice"` so Shopify applies the branded store email template, logo, contact details, and footer.
4. Use `gmail-draft-safe` only when the user wants Gmail specifically or Shopify native sending is unavailable.
5. Prepare a Shopify note with date, action taken, reason, expected timing, current status, and copy of the email.
6. Use `shopify-order-note-recorder` to write the note with `shopify_add_order_note` when requested and tools are available.

## Reporting

Say separately whether each step was completed:

- email drafted;
- Shopify native email sent, Gmail draft created, or send skipped pending approval;
- Shopify note text prepared;
- Shopify note actually written.

Do not say the note was added unless the write succeeds.

See `references/stock-delay-template.md`.
