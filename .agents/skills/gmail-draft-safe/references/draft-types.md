# Gmail draft types

## Supplier PO draft

Use when a supplier PO has been prepared from a Shopify order.

Required fields:

- supplier recipient;
- order number;
- item list with SKU and quantity;
- delivery address when required;
- request for confirmation;
- PaintAccess sign-off.

## Customer stock-delay draft

Use when items are out of stock or delayed.

Required fields:

- customer recipient;
- order number in subject;
- apology;
- affected product or brand;
- expected restock timing;
- dispatch plan after stock arrives;
- no-action-needed line;
- request for confirmation.

## Cancellation/refund customer draft

Use when customer requested cancellation/refund.

Required fields:

- customer name;
- order number;
- future-tense wording unless refund/cancellation is already complete.

## Shopify note handoff

After a confirmed draft, provide the email subject and body to `shopify-order-note-recorder` if the user wants the action stored in Shopify.

## Customer tracking update draft

Use when tracking was received and a customer update is required.

Required fields:

- customer recipient;
- order number;
- carrier;
- tracking number;
- shipped items if relevant;
- concise status update.
