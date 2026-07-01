# Order timeline entry templates

## Customer stock delay with email copy

```text
PaintAccess Ops: Customer update drafted/sent regarding stock delay. Affected item: {product_or_brand}. Expected restock: {restock_timing}. Customer told order will dispatch when stock arrives and no action is required unless confirmation is requested.

Details:

{short_email_summary_or_copy_if_requested}
```

## Supplier PO drafted

```text
PaintAccess Ops: Supplier PO draft prepared for {supplier}. Items: {short_item_summary}. Next action: review/send confirmation.
```

## Supplier PO sent

```text
PaintAccess Ops: Supplier PO sent to {supplier}. Items: {short_item_summary}. Next action: await supplier confirmation.
```

Suggested tag:

```text
PO sent - {supplier}
```

## Sales Confirmation checked

```text
PaintAccess Ops: Sales Confirmation checked for {supplier}. Confirmation: {confirmation_number_or_not_available}. Quantities: {quantity_summary}. Shipping: {shipping_charge}. Total: {total_amount}. Issues/changes: {issues_or_none}. Next action: payment approval.
```

Suggested tag:

```text
Sales Confirmation checked
```

## Payment approval required

```text
PaintAccess Ops: Payment approval required for {supplier}. Total: {total_amount}. Shipping: {shipping_charge}. Issues: {issues_or_none}. Next action: Daniel approval.
```

Suggested tag:

```text
Payment approval required
```

## Payment approved or processed

```text
PaintAccess Ops: Supplier order processed with {supplier}. Payment approved/processed via {payment_method}. Next action: await tracking.
```

Suggested tag:

```text
Payment processed
```

## Tracking received

```text
PaintAccess Ops: Tracking received from {supplier}. Carrier: {carrier}. Tracking: {tracking_number}. Shipped products: {shipped_products_or_not_specified}. Next action: prepare fulfilment.
```

Suggested tag:

```text
Tracking received
```

## Cancellation/refund reminder

```text
PaintAccess Ops: Cancellation/refund reminder. {customer} {source} requested cancellation/refund. Next action: Daniel to review and complete manually in Shopify Admin.
```

## Manual write fallback

If Shopify write tools are unavailable, prepare the timeline entry text and tell the user it was not recorded automatically.

## Customer timeline-change notification

Use this email shape when an internal timeline/status update should be mirrored to the customer.
Prefer `shopify_send_customer_email` with `delivery_method: "order_invoice"` after approval, so Shopify sends the message with the store's branded order email template, logo, contact details, and footer. Keep the custom message short and customer-safe; do not add a plain signature unless the user explicitly asks for it.

```text
Subject: Update on your PaintAccess order #{order_number}

Hi {customer_first_name},

We have an update for your PaintAccess order #{order_number}:

{customer_safe_update_summary}

No action is required from you unless we specifically ask for confirmation.
```

For test orders, keep the recipient as the test email on the order, usually `gluked@gmail.com`, and use a clearly test-only subject such as:

```text
Subject: TEST Update on your PaintAccess order #{order_number}
```
