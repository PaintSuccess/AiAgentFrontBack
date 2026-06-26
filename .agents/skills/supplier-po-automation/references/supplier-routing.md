# Supplier routing reference

## Mapping rules

- Prefer explicit product/vendor/supplier metadata from Shopify.
- If supplier is unclear, ask for confirmation.
- Do not infer a supplier only from product name unless a known mapping exists.
- Known successful case: Timbabuild/iQuip items from order #44478 were routed to iQuip/Timbabuild for a supplier-facing PO draft.
- Candidate mapping signals from prior chats include vendor, SKU prefix/suffix, product tags, product type, and confirmed supplier mapping table rows.

## Supplier examples to support

- Oldfields
- Soudal
- Norglass
- Opus
- IQuip / iQuip
- Timbabuild items routed to iQuip when confirmed by order/product context

Do not treat this list as a complete mapping table. Use it as a reminder of known suppliers and ask for exact mapping rules when needed.

## SKU and quantity transformation examples

Only apply these when the supplier rule is confirmed:

- Remove Shopify/internal suffixes such as `-D1` or `-D2` before sending to supplier.
- Interpret codes such as `P3` or `P4` as pack/quantity logic only when the user has supplied the exact rule.
- Preserve original Shopify SKU and supplier-facing SKU separately when they differ.

## PO fields

Include:

- supplier name;
- supplier-facing subject;
- PaintAccess order number;
- customer/order reference;
- product name;
- original SKU;
- supplier-facing SKU when transformed;
- quantity;
- delivery/shipping address when supplier dispatches directly;
- notes/payment instructions if supplier-specific rules require them;
- request for stock/order confirmation.

## PO email structure

Subject:

```text
Purchase Order for Shopify Order {order_number}
```

Body:

```text
Hi {supplier_contact},

Please see purchase order details for Shopify order {order_number}:

{items}

Delivery details:
{shipping_address}

Kind regards,
Daniel
PaintAccess
```

## Multi-supplier orders

Split by supplier and create one PO/email per supplier.

## Successful PO draft pattern

Use this shape for an iQuip/Timbabuild order:

```text
Subject: Purchase Order for PaintAccess - Order #{order_number}

Hi iQuip Team,

Please prepare the following order for PaintAccess.

Customer order: #{order_number}

{numbered_items_with_name_sku_quantity}

Delivery address:

{shipping_address}

Please confirm availability and send through order confirmation.

Kind regards,
PaintAccess
```
