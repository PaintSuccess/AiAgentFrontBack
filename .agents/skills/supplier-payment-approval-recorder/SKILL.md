---
name: supplier-payment-approval-recorder
description: coordinate and record Daniel's supplier payment approval for PaintAccess orders after Sales Confirmation review. use when payment approval is required, card-on-file processing is allowed, bank transfer is needed, payment is approved, payment is processed, or Shopify notes must show payment status and waiting-for-tracking state.
---

# Supplier Payment Approval Recorder

Use this skill after Sales Confirmation has been checked.

## Approval rule

Do not approve or process supplier payment without Daniel's explicit approval.

## Payment paths

- Supplier processes payment using card on file.
- PaintAccess pays by bank transfer.
- Payment remains waiting for approval.

## Workflow

1. Confirm Sales Confirmation check result.
2. If there are mismatches, stop and request Daniel review.
3. If clean, notify Daniel that payment approval is required.
4. Record Daniel's decision:
   - approved;
   - rejected/hold;
   - needs supplier clarification.
5. Record payment method when known:
   - card on file;
   - bank transfer;
   - other.
6. Use `shopify-order-note-recorder` to add:
   - payment approved/processed;
   - supplier can process payment or bank transfer required;
   - waiting for tracking.

## Standard note

```text
Order processed with supplier. Payment approved/processed. Waiting for tracking.
```

See `references/payment-statuses.md`.
