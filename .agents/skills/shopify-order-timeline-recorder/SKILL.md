---
name: shopify-order-timeline-recorder
description: prepare and record PaintAccess Shopify order timeline entries, tags, or status markers after customer emails, supplier PO drafts/sends, Sales Confirmation checks, payment approvals, supplier processing, tracking updates, cancellation reminders, stock-delay updates, or other operational actions. use when the user asks to record an order update, add an internal timeline entry, copy an email/action into Shopify, mark PO sent, record confirmation/payment/tracking status, or prevent duplicate processing. prefer shopify_record_order_timeline_entry and do not write operational logs into the persistent Shopify Notes field.
---

# Shopify Order Timeline Recorder

Use this skill to record operational actions back into a Shopify order.

## Preconditions

- Identify the order with high confidence.
- Know whether the user wants a timeline entry, tag, metafield, or all available safe markers.
- Use the workspace app `PaintAccess Operations` first:
  - `shopify_record_order_timeline_entry` for order timeline entries;
  - `shopify_remove_order_note_entry` only to correct or revert older PaintAccess Operations entries that were left in the persistent Shopify Notes field;
  - `shopify_add_order_tag` / `shopify_remove_order_tag` for tags;
  - `shopify_set_ops_metafield` for controlled `paintaccess_ops` state.
- Use `shopify-graphql-safe-mutation` only if no MCP tool covers the requested safe action.
- For `shopify_record_order_timeline_entry`, include a stable `request_id` when the timeline entry is part of a workflow. Reuse the same `request_id` if the ChatGPT approval/authorization prompt expires or the tool result is unclear, so the backend can avoid duplicate timeline entries.
- Never instruct the agent to use the persistent Shopify Notes field for operational logging. Say "record this in the Shopify order timeline."

## Timeline entry types

- Cancellation/refund reminder.
- Customer stock-delay email copy.
- Supplier PO drafted or sent.
- Supplier confirmation or availability update.
- Sales Confirmation checked.
- Payment approval required, approved, or processed.
- Tracking received and fulfilment prepared.
- Manual action required.

## Workflow

1. Confirm order number or GID.
2. Build a concise Shopify-timeline-style entry:
   - action taken;
   - source or recipient;
   - reason;
   - current status;
   - next action;
   - short copy or summary of email/PO only when requested.
3. If the timeline/status change should notify the customer, prepare a customer email notification before or immediately after the timeline entry:
   - use the order customer email from `shopify_get_order`;
   - for test orders tagged `PaintAccess Ops Test`, `AI Agent Test`, `TEST ORDER - DO NOT FULFILL`, or `DO NOT PROCESS`, send only to the test order email, usually `gluked@gmail.com`;
   - subject format: `Update on your PaintAccess order {order_number}`;
   - body should briefly say the order has an operations update, include the customer-safe summary, and avoid internal-only details such as supplier costs, payment approval notes, or manager instructions;
   - use `shopify_send_customer_email` with `delivery_method: "order_invoice"` when the user approved sending. This sends through Shopify's existing order invoice notification template, so Shopify applies the store's branded logo/contact/footer;
   - use Gmail only as a fallback when the user specifically asks for Gmail or Shopify native sending is unavailable;
   - send only when the user explicitly asked to send and supplied or confirmed an approval reference. For test-order pipeline tests, a user request such as "send this test notification" counts as approval when the recipient is `gluked@gmail.com`.
4. If marking a process, choose a tag/status phrase such as:
   - `PO sent`;
   - `PO sent - {Supplier}`;
   - `PO draft prepared`;
   - `Customer emailed - stock delay`;
   - `Awaiting customer confirmation`.
   - `Sales Confirmation checked`;
   - `Payment approval required`;
   - `Payment processed`;
   - `Tracking received`;
   - `Fulfilment prepared`.
5. Write the note/tag/metafield with the matching PaintAccess Operations MCP tool.
   - If ChatGPT says the timeline tool approval/authorization expired, immediately retry the same `shopify_record_order_timeline_entry` call once with the same `request_id`.
   - If retry still fails, report the exact blocker and show the prepared timeline entry so the user can decide whether to authorize again or record it manually.
   - Do not claim the timeline entry was recorded unless the tool confirms `timeline_entry_added` or says the matching entry already exists.
   - If the tool reports `persistent_note_changed: true`, warn the user that Shopify did not restore the persistent Notes field and manual cleanup may be needed.
6. When a customer notification was requested, report all three states separately:
   - Shopify timeline/tag/metafield write result;
   - Shopify native email provider/result, or Gmail draft/send fallback result;
   - the fact that send was skipped when approval was not given.
7. If only text was prepared, say that clearly.

## Duplicate prevention

Before sending supplier POs or marking a workflow complete, check existing order tags/timeline events/metafields when available through `shopify_get_order`. If a matching `PO sent` marker already exists, stop and ask before sending again.

## Customer notification after order timeline change

Use this subflow when the user asks to "notify the customer", "email the client", "send order update", or when a test pipeline explicitly asks to verify timeline + customer-notification behavior:

1. Read the order with `shopify_get_order`.
2. Record the internal timeline entry with `shopify_record_order_timeline_entry`.
3. Compose a customer-safe email from the timeline summary:
   - no internal manager instructions;
   - no supplier private details unless the user explicitly approved sharing them;
   - for test orders, mention it is a PaintAccess AI operations test if appropriate.
4. Send with `shopify_send_customer_email` only after explicit approval. Use `delivery_method: "order_invoice"` and include `approval_reference`.
5. Use Gmail draft/send only if Shopify native sending is blocked or the user explicitly wants Gmail.
6. If the email was sent, optionally record a second internal timeline entry confirming the notification was sent, but only if the user asked for a full audit trail.

See `references/timeline-entry-templates.md`.
