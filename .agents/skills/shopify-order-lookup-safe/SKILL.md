---
name: shopify-order-lookup-safe
description: safely identify paintaccess shopify orders before any operational action. use when a user provides an order number, screenshot, customer email, customer name, product, or partial order details and asks to find, inspect, modify, cancel, refund, note, or route the order. trigger whenever order identity is uncertain or a downstream skill needs a reliable shopify order id/name/gid before proceeding.
---

# Shopify Order Lookup Safe

Use this skill before any order-specific action when identity is not already certain.

## Objective

Find the correct Shopify order and prevent accidental updates to the wrong order.

## Inputs

Possible inputs:

- exact order number, e.g. 44394 or #44394;
- customer email text;
- screenshot;
- customer name/company;
- product name;
- date/amount/status hints.

## Workflow

1. Extract candidate identifiers from the user message.
2. Prefer exact order number over all other signals.
3. If an exact order number exists, retrieve that order with `shopify_get_order` from the workspace app `PaintAccess Shopify Operations`.
4. If only partial details exist, use `shopify_search_orders` or ask for clarification.
5. Before mutation, verify at least two relevant signals when possible:
   - order number;
   - customer name/company;
   - product/item;
   - order status;
   - email content.
6. Summarize only the decision and next safe action.

## Stop conditions

Ask for clarification when:

- screenshot does not show order number;
- multiple orders match;
- customer name/product alone is insufficient;
- the requested action is destructive or financial and the order is not certain.

## Output format

Return:

- confirmed order number/name;
- Shopify GID when available;
- confidence level: high/medium/low;
- key matching evidence;
- recommended next skill/action.

See `references/safe-identification-rules.md`.
