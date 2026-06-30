# Gmail draft types

## Supplier PO draft

Use when a supplier PO has been prepared from a Shopify order.

Required fields:

- supplier recipient;
- order number;
- item list with SKU and quantity;
- delivery address when required;
- request for confirmation;
- PaintAccess sign-off: `Kind regards,\nDaniel\nPaintAccess`.

## Customer stock-delay draft

Use only when items are out of stock or delayed and the user specifically wants Gmail. Otherwise use Shopify native sending with `shopify_send_customer_email` and `delivery_method: "order_invoice"` so the message uses the store's branded template.

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

Use when tracking was received and a Gmail customer update is specifically required. For actual fulfilment/tracking notifications, prefer `shopify_complete_fulfillment` with `notify_customer: true` after approval, because Shopify sends the branded fulfilment email.

Required fields:

- customer recipient;
- order number;
- carrier;
- tracking number;
- shipped items if relevant;
- concise status update.
- PaintAccess sign-off: `Kind regards,\nDaniel\nPaintAccess`.
