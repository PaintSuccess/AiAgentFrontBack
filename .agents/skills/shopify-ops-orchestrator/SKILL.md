---
name: shopify-ops-orchestrator
description: coordinate repeatable paintaccess shopify operations by selecting and sequencing other shopify skills. use when a user asks for an end-to-end Operations Desk workflow involving new Shopify orders, order lookup, cancellation/refund reminders, stock-delay customer emails, gmail drafts, supplier purchase orders, supplier routing, sales confirmation checks, payment approval, tracking, fulfilment preparation, shopify notes/tags/metafields, notifications, or post-operation skill improvement.
---

# Shopify Ops Orchestrator

Use this skill as the router for PaintAccess Shopify operations.

## Primary rule

Do not perform risky Shopify changes until the target resource is identified with high confidence. Prefer a safe lookup step before any mutation.

## Shopify MCP rule

Use the workspace app `PaintAccess Operations` as the default operations surface. It is backed by the repo endpoint `api/mcp/shopify.js` and exposes narrow tools for Shopify order lookup, readiness checks, notes, tags, ops metafields, fulfilment preparation, cancellation preparation, email templates, Gmail, and Google Drive.

Do not rely on the generic Shopify ChatGPT app for these pipelines; it is too limited for PaintAccess operational writes. Gmail and Google Drive should also use the PaintAccess Operations MCP backend, not personal ChatGPT Apps, unless the user explicitly chooses a temporary fallback.

Use these MCP tools by intent:

- `shopify_search_orders` for recent/partial order discovery.
- `shopify_get_order` for exact order inspection by order number, name, or GID.
- `shopify_get_fulfillment_readiness` before tracking or fulfilment preparation.
- `shopify_add_order_note` for operational notes and audit trail entries.
- `shopify_remove_order_note_entry` only to correct or revert a matching PaintAccess Operations note entry.
- `shopify_add_order_tag` / `shopify_remove_order_tag` for controlled workflow markers.
- `shopify_set_ops_metafield` for controlled `paintaccess_ops` state.
- `shopify_prepare_fulfillment` to prepare fulfilment data only; Daniel must approve final fulfilment.
- `shopify_complete_fulfillment` to complete final fulfilment with tracking only after explicit approval. Prefer this for marked test orders; for live orders require a clear Daniel approval reference and `allow_live_order`.
- `shopify_prepare_cancellation` to prepare cancellation/refund review only; Daniel must approve final cancellation/refund.
- `shopify_prepare_customer_email` to compose customer/supplier email copy from Shopify order details.
- `shopify_send_customer_email` to send through Shopify's draft-order invoice email pattern only after Daniel approval.
- `gmail_search_messages`, `gmail_get_message`, `gmail_create_draft`, and `gmail_send_email` for backend-authorized Gmail work.
- `drive_search_files`, `drive_get_file`, and `drive_create_text_file` for backend-authorized Google Drive work.

## Routing

Use this sequence:

1. Classify the request:
   - order identification;
   - cancellation/refund reminder;
   - stock-delay customer communication;
   - customer reply drafting;
   - Gmail search, draft creation, or send;
   - supplier PO automation;
   - supplier Sales Confirmation check;
   - payment approval/process recording;
   - supplier tracking and fulfilment preparation;
   - Shopify order note/status recording;
   - Operations Desk notification;
   - Shopify MCP tool call;
   - GraphQL mutation only if the MCP does not expose the needed safe action;
   - post-operation skill improvement.
2. Select the narrowest matching skill.
3. Chain skills in a safe order.
4. Confirm user intent before sensitive changes when required.
5. At the end of a repeatable operation, invoke the flow evolver logic.

## Common chains

### Cancel/refund reminder from email

1. `shopify-order-lookup-safe`
2. `shopify-order-cancellation-reminder`
3. `customer-email-reply-drafter` if a customer response is needed
4. `shopify-flow-skill-evolver`

### New order to supplier PO

1. `shopify-order-lookup-safe`
2. `supplier-po-automation`
3. `shopify_prepare_customer_email` to create the supplier/customer email template when needed
4. `gmail-draft-safe` if a supplier email draft or send step is requested
5. `operations-stage-notifier` to report order reviewed and PO readiness
6. `shopify-order-note-recorder` to record PO sent/drafted status when applicable
7. `shopify-flow-skill-evolver`

### Supplier Sales Confirmation received

1. `gmail-message-finder-safe` to find the supplier confirmation email
2. `supplier-sales-confirmation-checker`
3. `operations-stage-notifier` to report match/mismatch, shipping, total, and issues
4. `shopify-order-note-recorder` to record confirmation details and payment status
5. `supplier-payment-approval-recorder` when Daniel approval or payment processing is needed
6. `shopify-flow-skill-evolver`

### Payment approval or supplier processing

1. `supplier-payment-approval-recorder`
2. `operations-stage-notifier` to request or confirm payment approval
3. `shopify-order-note-recorder` to record payment approved/processed and waiting for tracking
4. `shopify-flow-skill-evolver`

### Supplier tracking received

1. `gmail-message-finder-safe` to find the supplier tracking email
2. `supplier-tracking-fulfillment-prep`
3. `operations-stage-notifier` to report tracking received and fulfilment readiness
4. `shopify-order-note-recorder` to record carrier/tracking/fulfilment status
5. Use `shopify_complete_fulfillment` only when final fulfilment is explicitly approved. For test orders, use fake tracking only when the user asked for a fulfilment-status test and keep `notify_customer` false unless specifically testing customer notification.
5. `shopify-flow-skill-evolver`

### Order stock delay customer email

1. `shopify-order-lookup-safe`
2. `shopify-stock-delay-customer-workflow`
3. `shopify_prepare_customer_email` for the customer-facing template
4. `gmail-draft-safe` if a Gmail draft should be created, or `shopify_send_customer_email` if Daniel approved Shopify-native sending
5. `shopify-order-note-recorder` to store the action and email copy
6. `shopify-flow-skill-evolver`

### Customer/supplier email copied into Shopify note

1. `shopify-order-lookup-safe`
2. `shopify-order-note-recorder`
3. `shopify-graphql-safe-mutation` only if `shopify_add_order_note` is unavailable or insufficient
4. `shopify-flow-skill-evolver`

### Shopify note change with customer notification

Use this when the user asks to add an order note and notify/email the customer/client, or when testing the note-notification pipeline.

1. `shopify-order-lookup-safe` to confirm the exact order, customer email, and any test-order markers.
2. `shopify-order-note-recorder` to write the internal note using `shopify_add_order_note`.
3. `gmail-draft-safe` to create a Gmail draft with the customer-safe note-change notification.
4. `gmail_send_email` only after explicit approval. For test orders addressed to `gluked@gmail.com`, a user request to send the test notification is enough approval if the agent reports the recipient, subject, and body before/while sending.
5. Report the Shopify note result, Gmail draft id, Gmail send id/status, and any skipped approval-gated steps.
6. `shopify-flow-skill-evolver`

### Any Shopify write without a dedicated tool

1. `shopify-order-lookup-safe` or equivalent resource lookup
2. Prefer the narrow `PaintAccess Operations` MCP tool
3. Use `shopify-graphql-safe-mutation` only after confirming no MCP tool covers the requested action
3. `shopify-flow-skill-evolver`

## Safety constraints

- Never cancel, refund, delete, fulfill, or financially modify an order unless the user explicitly asks and the available tool allows it.
- Never send supplier/customer emails, approve/process supplier payments, or complete final fulfilment without Daniel's approval unless the rule is explicitly changed.
- If only a screenshot is provided and the order number is not visible, ask for the order number or another reliable identifier.
- For refunds/cancellations, prefer adding an internal reminder and giving manual Admin steps unless an approved tool safely supports the action.
- Do not invent supplier mappings. Use existing mappings or ask for confirmation.
- Do not claim a Gmail draft, Drive file, Shopify email, or Shopify note was created unless the relevant MCP tool confirms it.
- Do not claim the generic Shopify app can complete admin-panel tasks. If a needed Shopify Admin action is not represented by the MCP, prepare a manual admin checklist or propose a backend/MCP extension.

See `references/flow-routing.md`.
See `references/operations-desk-lifecycle.md` for the full end-to-end product flow.
