# Operations Desk lifecycle

Use this lifecycle for the full PaintAccess order workflow.

## Stage 1: New order review

Inputs:

- Shopify order;
- line items;
- quantities;
- product/vendor/SKU/tags;
- supplier mapping rules.

Actions:

1. Identify products and quantities.
2. Identify supplier for each product.
3. Split into separate supplier PO groups when needed.
4. Notify that the order was reviewed and is ready for PO preparation.

Skills:

- `shopify-order-lookup-safe`
- `supplier-po-automation`
- `operations-stage-notifier`

## Stage 2: PO preparation and supplier draft

Actions:

1. Prepare PO per supplier.
2. Check PO against Shopify SKU, product name, quantity, supplier, and special instructions.
3. Create Gmail draft for supplier.
4. Notify that the supplier draft is ready for Daniel review.

Approval gate:

- Do not send email without Daniel approval.

Skills:

- `supplier-po-automation`
- `gmail-draft-safe`
- `operations-stage-notifier`

## Stage 3: Supplier Sales Confirmation

Actions:

1. Find supplier Sales Confirmation email in Gmail.
2. Compare supplier-confirmed products, quantities, prices, shipping charge, total, backorders, unavailable items, substitutions, and changes against PO and Shopify order.
3. Notify Daniel with a clear match/mismatch summary.
4. Add confirmation details to Shopify notes.

Skills:

- `gmail-message-finder-safe`
- `supplier-sales-confirmation-checker`
- `operations-stage-notifier`
- `shopify-order-note-recorder`

## Stage 4: Payment approval

Actions:

1. Request Daniel approval for supplier payment.
2. Record payment method: card on file or bank transfer.
3. After approval/process, add Shopify note: payment approved/processed, waiting for tracking.

Approval gate:

- Do not approve or process payment without Daniel approval.

Skills:

- `supplier-payment-approval-recorder`
- `operations-stage-notifier`
- `shopify-order-note-recorder`

## Stage 5: Tracking and fulfilment preparation

Actions:

1. Find supplier tracking email in Gmail.
2. Identify Shopify order, supplier, carrier, tracking number, and shipped products when provided.
3. Prepare customer update/draft if required.
4. Add tracking to Shopify and prepare fulfilment when tools allow.
5. Notify Daniel that fulfilment is prepared.

Approval gate:

- Do not complete final fulfilment without Daniel approval unless the rule is explicitly changed.

Skills:

- `gmail-message-finder-safe`
- `supplier-tracking-fulfillment-prep`
- `customer-email-reply-drafter`
- `shopify-order-note-recorder`
- `operations-stage-notifier`
