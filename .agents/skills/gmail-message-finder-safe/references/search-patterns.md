# Gmail search patterns

Use exact identifiers first.

## Sales Confirmation

Search ideas:

```text
"#{order_number}" "sales confirmation"
"{order_number}" "{supplier}" confirmation
"Purchase Order" "{order_number}" "{supplier}"
from:({supplier_domain}) "{order_number}"
```

Extract:

- confirmation number;
- confirmed products;
- quantities;
- unit prices;
- shipping charge;
- total confirmed amount;
- backorders/unavailable/substitutions/changes.

## Tracking

Search ideas:

```text
"#{order_number}" tracking
"{order_number}" consignment
"{supplier}" "{order_number}" shipped
from:({supplier_domain}) tracking
```

Extract:

- carrier;
- tracking number;
- supplier;
- related order number;
- shipped products when listed.

## Customer replies

Search ideas:

```text
"#{order_number}" from:({customer_email})
"{customer_name}" "{order_number}"
```
