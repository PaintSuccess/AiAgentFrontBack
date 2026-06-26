# Notification templates

## New order checked

```text
New order checked. Order #{order_number}. Supplier split: {supplier_summary}. Status: ready for PO preparation. Issues: {issues_or_none}.
```

## PO ready

```text
PO created and checked. Order #{order_number}. Supplier: {supplier}. Products and quantities match Shopify. Status: ready for supplier email draft.
```

## Supplier draft ready

```text
Supplier email draft prepared. Order #{order_number}. Supplier: {supplier}. Status: waiting for Daniel review before sending.
```

## Sales Confirmation checked

```text
Sales Confirmation checked. Order #{order_number}. Products and quantities: {match_status}. Supplier shipping charge: {shipping}. Total confirmed amount: {total}. Issues: {issues_or_none}. Next action: {next_action}.
```

## Payment approval required

```text
Payment approval required. Order #{order_number}. Supplier: {supplier}. Total confirmed amount: {total}. Shipping: {shipping}. Issues: {issues_or_none}.
```

## Tracking received

```text
Tracking received. Order #{order_number}. Supplier: {supplier}. Carrier: {carrier}. Tracking: {tracking_number}. Status: fulfilment prepared, waiting for Daniel approval.
```
