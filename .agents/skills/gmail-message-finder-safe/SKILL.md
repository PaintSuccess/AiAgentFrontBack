---
name: gmail-message-finder-safe
description: safely find PaintAccess Gmail messages for Shopify order workflows. use when looking for supplier Sales Confirmations, supplier tracking emails, customer replies, PO email threads, order-related Gmail messages, confirmation numbers, carrier/tracking details, or messages that must be compared with Shopify orders and purchase orders.
---

# Gmail Message Finder Safe

Use this skill before reading or acting on Gmail messages for order workflows.

## Core rules

- Prefer exact order number, supplier name, customer name, PO subject, confirmation number, or tracking keyword.
- Do not assume the first email is correct if multiple messages match.
- Summarize candidate matches and ask for selection when confidence is not high.
- Do not send, delete, archive, or modify messages from this skill.

## Workflow

1. Build a narrow Gmail search from available identifiers:
   - Shopify order number;
   - supplier name;
   - customer name;
   - PO subject;
   - terms such as `sales confirmation`, `order confirmation`, `tracking`, `consignment`, `shipped`.
2. Read candidate sender, subject, date, and snippet.
3. Choose the matching message only when it aligns with the order/supplier context.
4. Extract relevant content for the downstream skill:
   - Sales Confirmation details;
   - tracking details;
   - customer reply text.
5. Route to the next skill.

## Outputs

Return:

- matching confidence: high/medium/low;
- sender;
- subject;
- received date;
- key extracted fields;
- recommended next skill.

See `references/search-patterns.md`.
