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

## Shopify timeline entry templates

```text
PaintAccess Ops: Payment approval required for {supplier}. Sales Confirmation checked. Total: {amount}. Shipping: {shipping}. Next action: Daniel approval.
```

```text
PaintAccess Ops: Supplier order processed with {supplier}. Payment approved/processed via {payment_method}. Next action: await tracking.
```
