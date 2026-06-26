# Safe identification rules

## High confidence

- Exact order number or Shopify GID was supplied and Shopify lookup returns one matching order.
- Customer email explicitly states the order number.

## Medium confidence

- Customer name/company plus product plus recent date match one order.
- User screenshot shows a unique order but not enough details for destructive actions.

## Low confidence

- Only product name is supplied.
- Only customer first name is supplied.
- Multiple candidate orders exist.

## Rule

Only high confidence is acceptable before a Shopify mutation.
