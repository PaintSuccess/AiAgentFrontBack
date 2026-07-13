---
name: shopify-ops-orchestrator
description: coordinate repeatable paintaccess shopify operations by selecting and sequencing other shopify skills. use when a user asks for an end-to-end Operations Desk workflow involving new Shopify orders, order lookup, cancellation/refund reminders, stock-delay customer emails, gmail drafts, google drive file lookup, supplier purchase orders, supplier routing, sales confirmation checks, payment approval, tracking, fulfilment preparation, shopify timeline entries/tags/metafields, notifications, or post-operation skill improvement.
---

# Shopify Ops Orchestrator

Use this skill as the router for PaintAccess Shopify operations.

## Primary rule

Do not perform risky Shopify changes until the target resource is identified with high confidence. Prefer a safe lookup step before any mutation.

## Shopify MCP rule

Use the workspace app `PaintAccess Operations` as the default operations surface. It is backed by the repo endpoint `api/mcp/shopify.js` and exposes narrow tools for Shopify order lookup, readiness checks, timeline entries, tags, ops metafields, fulfilment preparation, cancellation preparation, email templates, Gmail, and Google Drive.

Do not rely on the generic Shopify ChatGPT app for these pipelines; it is too limited for PaintAccess operational writes. Gmail and Google Drive should also use the PaintAccess Operations MCP backend, not personal ChatGPT Apps, unless the user explicitly chooses a temporary fallback.

When a user asks for a read-only or prepare-only MCP check and names the relevant tool or operation, attempt the narrow MCP tool once before saying access is unavailable. If the tool is not available, authorization fails, or the call times out, report the exact tool name and visible error/blocker. Do not infer that the MCP is unavailable only because the current message is a new test or because earlier tool results are not in context.

When a write tool triggers a ChatGPT permission prompt, keep the next message short and focused on that pending tool call. Do not continue a long workflow while waiting for approval. If the prompt expires, retry the exact same write once with the same idempotency/request id when the tool supports it, then report a clean blocker if the retry also fails.

Use these MCP tools by intent:

- `shopify_search_orders` for recent/partial order discovery.
- `shopify_get_order` for exact order inspection by order number, name, or GID.
- `shopify_get_fulfillment_readiness` before tracking or fulfilment preparation.
- `shopify_record_order_timeline_entry` for operational order timeline entries and audit trail entries.
- `shopify_remove_order_note_entry` only to correct or revert older PaintAccess Operations entries left in the persistent Shopify Notes field.
- `shopify_add_order_tag` / `shopify_remove_order_tag` for controlled workflow markers.
- `shopify_set_ops_metafield` for controlled `paintaccess_ops` state.
- `shopify_prepare_fulfillment` to prepare fulfilment data only; Daniel must approve final fulfilment.
- `shopify_complete_fulfillment` to complete final fulfilment with tracking only after explicit approval. Prefer this for marked test orders; for live orders `allow_live_order` is also required. **The order must carry the `ops-approved` tag before calling this** — Daniel applies it directly in Shopify Admin (no MCP tool can add it). Calling this tool without the tag present fails with `approval_required` regardless of what `approval_reference` text is passed; `approval_reference` is logged for the audit trail only, it is not itself the approval.
- `shopify_prepare_cancellation` to prepare cancellation/refund review only; Daniel must approve final cancellation/refund. (There is no tool that can execute a cancellation or refund — this is enforced structurally, not just by policy.)
- `shopify_prepare_customer_email` to compose customer/supplier email copy from Shopify order details.
- `shopify_send_customer_email` to send approved customer emails through Shopify's branded native templates. Use `delivery_method: "order_invoice"` for existing-order customer updates, and `delivery_method: "draft_order_invoice"` only for supplier/fallback cases. **Same `ops-approved` tag requirement as `shopify_complete_fulfillment` above** — the order must carry it before this call will succeed.
- `gmail_search_messages`, `gmail_get_message`, `gmail_create_draft`, and `gmail_send_email` for backend-authorized Gmail work. **`gmail_send_email` is not tied to a Shopify order, so it cannot use the tag mechanism above** — it still only checks that `approval_reference` is a non-empty string. Treat that as a weaker guarantee: only call it after you have unambiguous, explicit approval in the current conversation, and say plainly in your response that you're relying on that, not on a system-enforced gate.
- `drive_search_files`, `drive_get_file`, and `drive_create_text_file` for backend-authorized Google Drive work.
- **Communications control center** (PaintAccess unified customer inbox across SMS, WhatsApp, website chat, and voice — backed by the app's own database, not Shopify Inbox):
  - `comms_search_threads` to find a customer's conversation thread by name, phone, email, or message text.
  - `comms_get_thread` to read one customer's full cross-channel history (by `thread_id`, `phone`, or `email`).
  - `comms_send_message` to send an SMS or WhatsApp reply as a human agent. **Requires `approval_reference`** (non-empty string — a weaker, non-order-tag gate, same as `gmail_send_email`): only send after unambiguous explicit approval in the current conversation, and say plainly you are relying on that, not a system-enforced gate. WhatsApp free text only works inside the customer's 24h service window.
  - `comms_take_over` to pause the AI on a thread so a human owns it (the AI stops auto-replying to inbound messages); `comms_hand_back` to return the thread to AI auto-reply.
  - `comms_start_call` to place an outbound recorded AI voice call to a customer. **Requires `approval_reference`** and carries consent / Do Not Call obligations — treat as customer-facing and approval-gated.

## Routing

Use this sequence:

1. Classify the request:
   - order identification;
   - cancellation/refund reminder;
   - stock-delay customer communication;
   - customer reply drafting;
   - Gmail search, draft creation, or send;
   - Google Drive file search or read;
   - supplier PO automation;
   - supplier Sales Confirmation check;
   - payment approval/process recording;
   - supplier tracking and fulfilment preparation;
   - Shopify order timeline/status recording;
   - customer conversation via the communications control center (read/reply/take over/call on SMS, WhatsApp, chat, voice);
   - Shopify Inbox or Admin panel request;
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
6. `shopify-order-timeline-recorder` to record PO sent/drafted status when applicable
7. `shopify-flow-skill-evolver`

### Supplier Sales Confirmation received

1. `gmail-message-finder-safe` to find the supplier confirmation email
2. `drive-file-finder-safe` if the confirmation or PO is expected in Google Drive instead of Gmail
3. `supplier-sales-confirmation-checker`
4. `operations-stage-notifier` to report match/mismatch, shipping, total, and issues
5. `shopify-order-timeline-recorder` to record confirmation details and payment status
6. `supplier-payment-approval-recorder` when Daniel approval or payment processing is needed
7. `shopify-flow-skill-evolver`

### Payment approval or supplier processing

1. `supplier-payment-approval-recorder`
2. `operations-stage-notifier` to request or confirm payment approval
3. `shopify-order-timeline-recorder` to record payment approved/processed and waiting for tracking
4. `shopify-flow-skill-evolver`

### Supplier tracking received

1. `gmail-message-finder-safe` to find the supplier tracking email
2. `drive-file-finder-safe` if tracking, packing slip, or shipment attachment is expected in Google Drive
3. `supplier-tracking-fulfillment-prep`
4. `operations-stage-notifier` to report tracking received and fulfilment readiness
5. `shopify-order-timeline-recorder` to record carrier/tracking/fulfilment status
6. Use `shopify_complete_fulfillment` only when final fulfilment is explicitly approved. For test orders, use fake tracking only when the user asked for a fulfilment-status test and keep `notify_customer` false unless specifically testing customer notification.
7. `shopify-flow-skill-evolver`

### Google Drive file lookup

Use this when the user asks to find PO files, supplier attachments, Drive records, order documents, or files related to an order.

1. `shopify-order-lookup-safe` when the request is order-related.
2. `drive-file-finder-safe` to search Drive with separate narrow queries.
3. `drive_get_file` only when one candidate is clearly relevant or the user selects it.
4. Route extracted content to the matching downstream skill.

### Customer conversation / unified inbox request

Use this when the user asks to read, search, summarize, reply to, take over, or call in a customer conversation (SMS, WhatsApp, website chat, or voice).

1. For SMS / WhatsApp / website-chat / voice, use the **communications control center** tools: `comms_search_threads` → `comms_get_thread` to read history, `comms_send_message` to reply (approval required), `comms_take_over` / `comms_hand_back` to control AI auto-reply, `comms_start_call` for an outbound recorded call (approval required). These are backed by the app's own database and unify all channels per customer.
2. **Shopify's native Inbox chat product itself is still not exposed** by the MCP — do not claim to read/reply inside Shopify Inbox specifically, invent Inbox access, or use browser automation unless the user explicitly asks for browser-based manual operation. If the conversation lives only in Shopify Inbox (not SMS/WhatsApp/chat/voice), offer Gmail search, Shopify order lookup, Shopify-native customer email, or a manual checklist.
3. Before sending or calling, confirm the exact contact via `comms_get_thread` and report the recipient, channel, and message/intent. Never send or call without explicit approval in the current conversation.

### Common chain — take over a live customer conversation

1. `comms_search_threads` (or `comms_get_thread` by phone/email) to locate the thread and read recent messages.
2. `comms_take_over` to pause the AI when a human needs to handle it.
3. `comms_send_message` to reply (after approval), or `comms_start_call` to call (after approval).
4. `comms_hand_back` to return the thread to the AI when done.

### Order stock delay customer email

1. `shopify-order-lookup-safe`
2. `shopify-stock-delay-customer-workflow`
3. `shopify_prepare_customer_email` for the customer-facing template
4. `shopify_send_customer_email` with `delivery_method: "order_invoice"` if Daniel approved Shopify-native sending, or `gmail-draft-safe` only when Gmail is requested as the channel
5. `shopify-order-timeline-recorder` to store the action and email copy
6. `shopify-flow-skill-evolver`

### Customer/supplier email copied into Shopify timeline

1. `shopify-order-lookup-safe`
2. `shopify-order-timeline-recorder`
3. `shopify-graphql-safe-mutation` only if `shopify_record_order_timeline_entry` is unavailable or insufficient
4. `shopify-flow-skill-evolver`

### Shopify timeline change with customer notification

Use this when the user asks to record an order timeline update and notify/email the customer/client, or when testing the timeline-notification pipeline.

1. `shopify-order-lookup-safe` to confirm the exact order, customer email, and any test-order markers.
2. `shopify-order-timeline-recorder` to record the internal timeline entry using `shopify_record_order_timeline_entry`.
3. `shopify_prepare_customer_email` to prepare the customer-safe message if the copy is not already prepared.
4. `shopify_send_customer_email` with `delivery_method: "order_invoice"` only after explicit approval. For test orders addressed to `gluked@gmail.com`, a user request to send the test notification is enough approval if the agent reports the recipient, subject, body/custom message, and Shopify provider before/while sending.
5. Use Gmail only as a fallback or if the user explicitly asks for Gmail.
6. Report the Shopify timeline result, Shopify email provider/result, and any skipped approval-gated steps.
7. `shopify-flow-skill-evolver`

### Any Shopify write without a dedicated tool

1. `shopify-order-lookup-safe` or equivalent resource lookup
2. Prefer the narrow `PaintAccess Operations` MCP tool
3. Use `shopify-graphql-safe-mutation` only after confirming no MCP tool covers the requested action
3. `shopify-flow-skill-evolver`

## Safety constraints

- Never cancel, refund, delete, fulfill, or financially modify an order unless the user explicitly asks and the available tool allows it.
- Never send supplier/customer emails, approve/process supplier payments, or complete final fulfilment without Daniel's approval unless the rule is explicitly changed.
- Never send a customer SMS/WhatsApp (`comms_send_message`) or place an outbound call (`comms_start_call`) without explicit approval in the current conversation — both are customer-facing and only gated by a non-empty `approval_reference`, not a system-enforced order tag. Report the recipient, channel, and message/intent before or while sending.
- For prepare-only tools such as `shopify_prepare_fulfillment`, `shopify_prepare_cancellation`, and `shopify_prepare_customer_email`, report if a tool call stalls or asks for unexpected permission instead of waiting indefinitely or escalating to a final action.
- If only a screenshot is provided and the order number is not visible, ask for the order number or another reliable identifier.
- For refunds/cancellations, prefer recording an internal timeline reminder and giving manual Admin steps unless an approved tool safely supports the action.
- For Shopify Inbox, report it as unsupported by the current MCP. The current safe response is a manual checklist or a proposal for a supported integration path, not a claimed Inbox read/reply.
- Do not invent supplier mappings. Use existing mappings or ask for confirmation.
- Do not claim a Gmail draft, Drive file, Shopify email, or Shopify timeline entry was created unless the relevant MCP tool confirms it.
- Do not claim the generic Shopify app can complete admin-panel tasks. If a needed Shopify Admin action is not represented by the MCP, prepare a manual admin checklist or propose a backend/MCP extension.

See `references/flow-routing.md`.
See `references/operations-desk-lifecycle.md` for the full end-to-end product flow.
