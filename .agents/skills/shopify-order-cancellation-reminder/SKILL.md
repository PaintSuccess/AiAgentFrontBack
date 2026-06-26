---
name: shopify-order-cancellation-reminder
description: handle paintaccess shopify cancellation or refund reminder requests by checking the target order, confirming status, and adding an internal note/reminder instead of directly processing sensitive financial actions. use when a customer asks to cancel, refund, delete, or stop an order, or when the user asks to write a reminder inside a shopify order for daniel or staff to cancel/refund it.
---

# Shopify Order Cancellation Reminder

Use this skill when the user wants an internal Shopify reminder/note for cancellation, refund, or deletion.

## Objective

Create a clear internal order note that helps staff complete the cancellation/refund safely.

## Preconditions

- A specific order must be identified with high confidence.
- Use `shopify-order-lookup-safe` first if order identity is uncertain.
- Use `shopify_prepare_cancellation` from `PaintAccess Shopify Operations` when a cancellation/refund action needs structured review.
- Use `shopify_add_order_note` through `shopify-order-note-recorder` for internal reminders.

## Workflow

1. Confirm the order number/name.
2. Check status when possible:
   - paid/unpaid;
   - fulfilled/unfulfilled;
   - cancelled/open.
3. Do not directly refund/cancel. Prepare the cancellation/refund review and internal note; Daniel must approve/perform the final action unless rules change.
4. Draft an internal note with:
   - staff name if provided;
   - customer name/company;
   - request source, e.g. email/phone;
   - requested action;
   - order number;
   - product/reason if known.
5. Add/update the order note with `shopify_add_order_note`.
6. Tell the user the reminder was added and state whether manual cancellation/refund remains.

## Default note template

```text
Daniel, reminder: {customer_name/company} {request_source} requesting cancellation and refund for order {order_number}{product_clause}. Please cancel/refund this order.
```

## Example

Input:

```text
Gerry from Alchemy Painting emailed asking to cancel/refund order 44394 for a box of Timbaglaze.
```

Note:

```text
Daniel, reminder: Gerry from Alchemy Painting emailed requesting cancellation and refund for order #44394 (box of Timbaglaze). Please cancel/refund this order.
```

See `references/cancel-refund-note-template.md`.
