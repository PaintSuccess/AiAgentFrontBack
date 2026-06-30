---
name: customer-email-reply-drafter
description: draft paintaccess customer replies for shopify order situations including cancellation, refund, order status, supplier delay, out-of-stock/backorder updates, pickup, delivery, and confirmation messages. use when the user pastes a customer email, asks to respond to a customer, needs a Gmail draft, or needs professional english text from daniel or paintaccess related to a shopify order.
---

# Customer Email Reply Drafter

Use this skill to draft concise, professional PaintAccess customer replies.

## Voice

- Friendly and direct.
- Use British/Australian spelling where natural.
- Avoid overexplaining internal processes.
- Do not promise actions already not completed unless the wording is future-tense.

## Cancellation/refund reply

Use when customer asks to cancel/refund:

```text
Hi {name},

Thanks for your message.

No worries, we'll cancel order {order_number} and process the refund for you.

Kind regards,
Daniel
PaintAccess
```

## Stock-delay reply

Use `shopify-stock-delay-customer-workflow` when the message is part of the full workflow: Shopify order lookup, Shopify-native or Gmail customer email, and Shopify note recording.

For drafting only, include:

- apology;
- affected product or brand;
- expected restock timing;
- dispatch promise after stock arrives;
- "nothing to do" line;
- request to confirm the wait is acceptable.

If cancellation/refund has already been completed, change to:

```text
Hi {name},

Thanks for your message.

Order {order_number} has now been cancelled and the refund has been processed.

Kind regards,
Daniel
PaintAccess
```

## Workflow

1. Identify customer name/company.
2. Identify requested action.
3. Identify order number if available.
4. Draft only the message unless the user asks for explanation.
5. Do not mention internal notes or automation.

See `references/email-templates.md`.
