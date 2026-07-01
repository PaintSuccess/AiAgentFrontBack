---
name: shopify-order-cancellation-reminder
description: handle paintaccess shopify cancellation or refund reminder requests by checking the target order, confirming status, and recording an internal Shopify order timeline reminder instead of directly processing sensitive financial actions. use when a customer asks to cancel, refund, delete, or stop an order, or when the user asks to write a reminder inside a shopify order for daniel or staff to cancel/refund it.
---

# Shopify Order Cancellation Reminder

Use this skill when the user wants a cancellation/refund assessment or an internal Shopify timeline reminder for cancellation, refund, or deletion.

## Objective

Create a clear internal order timeline entry that helps staff complete the cancellation/refund safely.

## Preconditions

- A specific order must be identified with high confidence.
- Use `shopify-order-lookup-safe` first if order identity is uncertain.
- Use `shopify_prepare_cancellation` from `PaintAccess Operations` when a cancellation/refund action needs structured review. This is prepare-only and must not cancel, refund, restock, email, tag, or update the order.
- Use `shopify_record_order_timeline_entry` through `shopify-order-timeline-recorder` for internal reminders.

## Workflow

1. Confirm the order number/name.
2. Check status when possible:
   - paid/unpaid;
   - fulfilled/unfulfilled;
   - cancelled/open.
3. Do not directly refund/cancel. Prepare the cancellation/refund review first; Daniel must approve/perform the final action unless rules change.
4. Draft an internal timeline entry with:
   - staff name if provided;
   - customer name/company;
   - request source, e.g. email/phone;
   - requested action;
   - order number;
   - product/reason if known.
5. Record the timeline entry with `shopify_record_order_timeline_entry` only if the user requested a reminder write or approved that write after the prepare-only review.
6. Tell the user whether this was prepare-only or whether a reminder was added, and state whether manual cancellation/refund remains.

## Default timeline template

```text
PaintAccess Ops: Cancellation/refund reminder. {customer_name/company} {request_source} requested cancellation/refund for order {order_number}{product_clause}. Next action: Daniel to review and complete manually in Shopify Admin.
```

## Example

Input:

```text
Gerry from Alchemy Painting emailed asking to cancel/refund order 44394 for a box of Timbaglaze.
```

Timeline entry:

```text
PaintAccess Ops: Cancellation/refund reminder. Gerry from Alchemy Painting emailed requesting cancellation/refund for order #44394 (box of Timbaglaze). Next action: Daniel to review and complete manually in Shopify Admin.
```

See `references/cancel-refund-note-template.md`.
