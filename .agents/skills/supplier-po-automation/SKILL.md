---
name: supplier-po-automation
description: prepare paintaccess supplier purchase order workflows from shopify orders. use when a new order needs supplier identification, supplier-specific purchase order preparation, gmail/email routing, or supplier dispatch communication. trigger when the user mentions suppliers, purchase orders, po creation, new shopify orders, product-to-supplier mapping, iqubit/iquip or other supplier routing.
---

# Supplier PO Automation

Use this skill to turn Shopify orders into supplier purchase order workflows.

## Objective

Create a reliable chain:

Shopify order -> supplier mapping -> PO draft -> supplier email -> Shopify note/status update.

## Preconditions

- Identify the Shopify order safely.
- Confirm supplier mapping exists or ask for confirmation.
- Do not invent supplier emails or PO details.

## Workflow

1. Retrieve the order.
2. Extract line items, quantities, variants, shipping address, and customer notes.
3. Map each line item to a supplier.
4. If multiple suppliers exist, split into supplier-specific PO groups.
5. Apply supplier-facing SKU and quantity transformations only from known rules or user confirmation.
6. Prepare a PO summary for each supplier.
7. Draft supplier email.
8. If Gmail sending is requested and available, use `gmail-draft-safe`; send only after user confirmation unless the user has pre-approved automation.
9. Use `shopify-order-note-recorder` to document PO/email action and prevent duplicate PO sends.

## Output

For each supplier:

- supplier name;
- items and quantities;
- customer/order reference;
- shipping details if relevant;
- draft email;
- next action: send/confirm/update.

See `references/supplier-routing.md`.
See `references/automation-options.md` when the user asks about full automation, Shopify Flow, Make/Zapier, or middleware.
