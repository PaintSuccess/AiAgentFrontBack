# Flow routing reference

## Intent detection

- "cancel", "refund", "delete order", "Gerry emailed" -> cancellation reminder flow.
- "which supplier", "purchase order", "PO", "send to supplier" -> supplier PO flow.
- "sales confirmation", "supplier confirmation", "confirmation number", "supplier invoice" -> Sales Confirmation check flow.
- "approve payment", "payment approval", "card on file", "bank transfer", "processed by supplier" -> payment approval flow.
- "tracking", "consignment", "carrier", "ready for fulfilment", "fulfillment" -> tracking/fulfilment prep flow.
- "notify Daniel", "send notification", "ready for review", "approval required" -> Operations Desk notification flow.
- "out of stock", "back in stock", "delay", "customer update" -> stock-delay customer workflow.
- "create Gmail draft", "draft email", "send supplier email" -> Gmail draft flow, with send confirmation before sending.
- "notify customer", "email client", "send order update", "note-change notification" -> Shopify native order email flow, with Daniel approval before sending.
- "add note", "write inside order", "remark" -> order note flow, using `shopify_add_order_note` from the PaintAccess Operations MCP.
- "PO sent", "already emailed", "copy of email", "record this in Shopify" -> order note/status recorder.
- "reply to customer", "write email" -> customer email draft flow.

## Minimum confidence to mutate Shopify

A Shopify write requires at least one:

- exact order number/name, e.g. #44394;
- Shopify GID;
- unambiguous order returned from Shopify lookup with matching customer/email/items.

If not available, ask a clarifying question.

## Supported automation chains from source chats

### Manual ChatGPT supplier PO run

User provides an order number or asks to check recent orders.

1. Identify the order.
2. Extract line items, SKU, quantity, customer, and shipping address.
3. Determine suppliers from vendor, title, SKU, tags, product type, or confirmed mapping table.
4. Split one order into multiple supplier-specific PO drafts when needed.
5. Prepare supplier email drafts.
6. Record the draft/sent status in Shopify notes, tags, or metafields through the PaintAccess Operations MCP when requested.

### Stock-delay customer email and note

1. Identify the order.
2. Draft a customer delay email with apology, item/out-of-stock reason, expected restock timing, no-action-needed line, and confirmation request.
3. Send through `shopify_send_customer_email` with `delivery_method: "order_invoice"` only after Daniel approval, so Shopify applies the branded order email template.
4. Create a Gmail draft only if Gmail is available and requested instead of Shopify native sending.
5. Add a Shopify order note with date, action taken, reason, expected timing, current status, and copy of the customer email using `shopify_add_order_note`.

### Fully automated external workflow

For background automation, route to external systems: Shopify Flow, Make/Zapier, or custom middleware. A normal chat can run the flow on demand, but cannot continuously monitor Shopify by itself.

## Shopify MCP routing

Use the workspace app `PaintAccess Operations` for Shopify, Gmail, and Drive work:

- lookup/search: `shopify_search_orders`, `shopify_get_order`;
- fulfilment checks: `shopify_get_fulfillment_readiness`;
- audit notes: `shopify_add_order_note`;
- workflow markers: `shopify_add_order_tag`, `shopify_remove_order_tag`, `shopify_set_ops_metafield`;
- prepared final actions: `shopify_prepare_fulfillment`, `shopify_prepare_cancellation`;
- customer notifications: `shopify_prepare_customer_email`, `shopify_send_customer_email` with `delivery_method: "order_invoice"`.

Use `shopify-graphql-safe-mutation` only as an escalation path when the MCP does not expose a safe narrow tool for the action.

## Human approval gates

Require Daniel approval before:

- sending supplier/customer emails;
- approving or processing supplier payment;
- cancelling orders;
- issuing refunds;
- completing final fulfilment.

Drafting, checking, comparing, preparing notes, and preparing fulfilment can happen before approval.
