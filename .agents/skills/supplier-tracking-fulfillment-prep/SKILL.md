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
4. Use `shopify_get_fulfillment_readiness` to check whether the order can be prepared for fulfilment.
5. Use `shopify_prepare_fulfillment` only to prepare the Shopify fulfilment payload/status; do not complete final fulfilment.
6. Prepare customer update email only when required.
7. Use `shopify-order-timeline-recorder` to record tracking received and fulfilment status.
8. Notify Daniel that fulfilment is ready for approval.

## Standard timeline entry

```text
PaintAccess Ops: Tracking received from supplier. Carrier: {carrier}. Tracking: {tracking_number}. Next action: prepare fulfilment.
```

See `references/tracking-checklist.md`.
