# Order note templates

## Customer stock delay with email copy

```text
{date} - Customer emailed regarding stock delay for order #{order_number}. Advised that {product_or_brand} products are currently out of stock and distributor expects stock in approximately {restock_timing}. Customer informed that order will be dispatched immediately upon stock arrival and no action is required from their side. Awaiting customer confirmation.

Copy of email:

{email_body}
```

## Supplier PO drafted

```text
{date} - Supplier PO draft prepared for {supplier} for order #{order_number}. Items: {short_item_summary}. Awaiting review/send confirmation.
```

## Supplier PO sent

```text
{date} - Supplier PO sent to {supplier} for order #{order_number}. Items: {short_item_summary}. Awaiting supplier confirmation.
```

Suggested tag:

```text
PO sent - {supplier}
```

## Sales Confirmation checked

```text
{date} - Sales Confirmation checked for {supplier} on order #{order_number}. Confirmation number: {confirmation_number_or_not_available}. Confirmed quantities: {quantity_summary}. Shipping charge: {shipping_charge}. Total confirmed amount: {total_amount}. Issues/changes: {issues_or_none}. Payment status: waiting for payment approval.
```

Suggested tag:

```text
Sales Confirmation checked
```

## Payment approval required

```text
{date} - Payment approval required for supplier order with {supplier}. Total confirmed amount: {total_amount}. Shipping: {shipping_charge}. Issues: {issues_or_none}. Waiting for Daniel approval.
```

Suggested tag:

```text
Payment approval required
```

## Payment approved or processed

```text
{date} - Order processed with supplier {supplier}. Payment approved/processed via {payment_method}. Waiting for tracking.
```

Suggested tag:

```text
Payment processed
```

## Tracking received

```text
{date} - Tracking received from supplier {supplier}. Carrier: {carrier}. Tracking number: {tracking_number}. Shipped products: {shipped_products_or_not_specified}. Order ready for fulfilment / fulfilment prepared.
```

Suggested tag:

```text
Tracking received
```

## Cancellation/refund reminder

```text
Daniel, reminder: {customer} {source} requesting cancellation and refund for order #{order_number}. Please cancel/refund this order.
```

## Manual write fallback

If Shopify write tools are unavailable, prepare the note text and tell the user it was not added automatically.

## Customer note-change notification

Use this email shape when an internal note/status update should be mirrored to the customer.

```text
Subject: Update on your PaintAccess order #{order_number}

Hi {customer_first_name},

We have an update for your PaintAccess order #{order_number}:

{customer_safe_update_summary}

No action is required from you unless we specifically ask for confirmation.

Kind regards,
Daniel
PaintAccess
```

For test orders, keep the recipient as the test email on the order, usually `gluked@gmail.com`, and use a clearly test-only subject such as:

```text
Subject: TEST Update on your PaintAccess order #{order_number}
```
