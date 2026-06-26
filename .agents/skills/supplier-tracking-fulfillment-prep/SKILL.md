---
name: supplier-tracking-fulfillment-prep
description: process supplier tracking emails for PaintAccess Shopify orders and prepare Shopify fulfilment without completing it automatically. use when a supplier sends tracking, carrier, consignment, shipped-products details, delivery confirmation, or when tracking must be added to Shopify and fulfilment prepared for Daniel approval.
---

# Supplier Tracking Fulfilment Prep

Use this skill when supplier tracking arrives.

## Approval rule

Prepare tracking and fulfilment, but do not complete final Shopify fulfilment without Daniel's approval unless the rule is explicitly changed.

## Preconditions

- Find the tracking email with `gmail-message-finder-safe`.
- Identify the Shopify order with high confidence.
- Confirm supplier and carrier/tracking details.

## Check list

Extract and verify:

- Shopify order number;
- supplier;
- carrier;
- tracking number;
- shipped products if provided;
- partial shipment/backorder details if provided.

## Workflow

1. Match tracking email to Shopify order.
2. Extract carrier and tracking number.
3. Compare shipped products with order/PO/Sales Confirmation when product details are present.
4. Prepare Shopify tracking update and fulfilment draft.
5. Prepare customer update email only when required.
6. Use `shopify-order-note-recorder` to record tracking received and fulfilment status.
7. Notify Daniel that fulfilment is ready for approval.

## Standard note

```text
Tracking received from supplier. Carrier: {carrier}. Tracking number: {tracking_number}. Order ready for fulfilment / fulfilment prepared.
```

See `references/tracking-checklist.md`.
