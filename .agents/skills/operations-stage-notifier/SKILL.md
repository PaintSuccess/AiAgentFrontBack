---
name: operations-stage-notifier
description: prepare clear PaintAccess Operations Desk notifications at key workflow stages. use when notifying Daniel or the operations team that an order was checked, PO is ready, supplier email draft is prepared, Sales Confirmation was received/checked, payment approval is required, payment was processed, tracking was received, Shopify was updated, or fulfilment is ready for approval.
---

# Operations Stage Notifier

Use this skill to generate concise stage notifications for PaintAccess Operations Desk.

## Core rules

- Keep notifications short and decision-oriented.
- State the stage, order number, supplier, status, issues, and required action.
- Never imply an approval has happened unless Daniel explicitly approved it.
- Distinguish prepared/drafted from sent/processed/completed.

## Notification stages

- New order checked.
- PO created and checked against quantities.
- Supplier email draft prepared.
- Supplier Sales Confirmation received.
- Sales Confirmation checked against prices, quantities, and shipping.
- Payment approval required.
- Payment/order processed.
- Tracking number received.
- Shopify order updated and fulfilment prepared.

## Output format

```text
{stage}. Order #{order_number}. Supplier: {supplier}. Status: {status}. Issues: {issues_or_none}. Next action: {action}.
```

See `references/notification-templates.md`.
