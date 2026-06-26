---
name: shopify-order-note-recorder
description: prepare and record PaintAccess Shopify order notes, tags, or status markers after customer emails, supplier PO drafts/sends, Sales Confirmation checks, payment approvals, supplier processing, tracking updates, cancellation reminders, stock-delay updates, or other operational actions. use when the user asks to add a note, copy an email into Shopify, mark PO sent, record confirmation/payment/tracking status, or prevent duplicate processing.
---

# Shopify Order Note Recorder

Use this skill to record operational actions back into a Shopify order.

## Preconditions

- Identify the order with high confidence.
- Know whether the user wants a note, tag, metafield, or all available safe markers.
- Use the workspace app `PaintAccess Shopify Operations` first:
  - `shopify_add_order_note` for notes;
  - `shopify_add_order_tag` / `shopify_remove_order_tag` for tags;
  - `shopify_set_ops_metafield` for controlled `paintaccess_ops` state.
- Use `shopify-graphql-safe-mutation` only if no MCP tool covers the requested safe action.

## Note types

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
2. Build a concise internal note:
   - date;
   - action taken;
   - source or recipient;
   - reason;
   - current status;
   - next action;
   - copy of email or PO when requested.
3. If marking a process, choose a tag/status phrase such as:
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
4. Write the note/tag/metafield with the matching PaintAccess Shopify Operations MCP tool.
5. Report whether the write succeeded. If only text was prepared, say that clearly.

## Duplicate prevention

Before sending supplier POs or marking a workflow complete, check existing order tags/notes/metafields when available through `shopify_get_order`. If a matching `PO sent` marker already exists, stop and ask before sending again.

See `references/note-templates.md`.
