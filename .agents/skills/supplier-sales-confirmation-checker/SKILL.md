---
name: supplier-sales-confirmation-checker
description: compare supplier Sales Confirmations against PaintAccess Shopify orders and Purchase Orders. use when a supplier confirmation email, order confirmation, invoice-like confirmation, pricing confirmation, shipping charge, backorder, unavailable item, substitution, or supplier change must be checked before payment approval and Shopify notes are updated.
---

# Supplier Sales Confirmation Checker

Use this skill after the supplier sends a Sales Confirmation.

## Preconditions

- Identify the Shopify order with high confidence.
- Find the supplier confirmation email with `gmail-message-finder-safe`.
- Have the prepared PO or reconstructed PO details from `supplier-po-automation`.

## Check list

Compare the Sales Confirmation against the PO and Shopify order:

- products confirmed by supplier;
- SKU/product names;
- quantities;
- unit prices when available;
- supplier shipping charge;
- total confirmed amount;
- confirmation number if available;
- backorders;
- unavailable items;
- substitutions;
- product, quantity, price, or shipping changes.

## Workflow

1. Extract confirmation fields from the Gmail message or attachment text.
2. Reconstruct expected order lines from Shopify/PO.
3. Compare line by line.
4. Classify result:
   - match;
   - minor difference;
   - mismatch;
   - needs Daniel review.
5. Produce a notification-ready summary.
6. Send details to `shopify-order-note-recorder`.
7. Route to `supplier-payment-approval-recorder` only after Daniel can review the result.

## Output format

```text
Sales Confirmation checked.
Products and quantities: match / do not match.
Supplier shipping charge: {amount}.
Total confirmed amount: {amount}.
Issues: {none_or_list}.
Payment approval: required / not ready.
```

See `references/confirmation-checklist.md`.
