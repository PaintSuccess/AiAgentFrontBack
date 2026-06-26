# Payment statuses

## Status values

- `waiting for payment approval`
- `payment approved - card on file`
- `payment approved - bank transfer required`
- `payment processed by supplier`
- `payment on hold - supplier clarification required`

## Notification templates

```text
Payment approval required for order #{order_number}. Supplier: {supplier}. Total confirmed amount: {amount}. Shipping: {shipping}. Issues: {issues}.
```

```text
Payment/order processed for order #{order_number}. Supplier: {supplier}. Payment status: {status}. Waiting for tracking.
```

## Shopify note templates

```text
{date} - Payment approval required for supplier order with {supplier}. Sales Confirmation checked. Total confirmed amount: {amount}. Shipping: {shipping}. Waiting for Daniel approval.
```

```text
{date} - Order processed with supplier {supplier}. Payment approved/processed via {payment_method}. Waiting for tracking.
```
