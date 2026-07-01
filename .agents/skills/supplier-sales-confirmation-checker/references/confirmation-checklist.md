# Sales Confirmation checklist

## Required comparison table

Create a compact table with:

- Shopify SKU;
- supplier SKU if different;
- product name;
- Shopify quantity;
- PO quantity;
- supplier confirmed quantity;
- unit price;
- line total;
- status.

## Summary fields for Shopify timeline entry

Include:

- supplier confirmed the order;
- supplier name;
- confirmation number if available;
- confirmed product quantities;
- supplier shipping charge;
- total confirmed amount;
- backorders/unavailable/substitutions/changes;
- payment status: waiting for payment approval.

## Stop conditions

Stop before payment approval when:

- products or quantities do not match;
- total is missing or unclear;
- shipping charge is unexpected or unclear;
- supplier substituted an item;
- backorder/unavailable item changes customer timing.
