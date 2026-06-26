---
name: gmail-draft-safe
description: create or prepare safe PaintAccess Gmail drafts for customers or suppliers from Shopify workflows. use when the user asks to create a Gmail draft, draft supplier PO email, draft customer stock-delay email, prepare an email for review, send an email only after confirmation, or record an email copy back to Shopify.
---

# Gmail Draft Safe

Use this skill for PaintAccess Gmail draft creation from Shopify operations.

## Core rules

- Create drafts for review by default.
- Do not send email unless the user explicitly asks to send and the available Gmail tool supports it.
- If sending, confirm recipient, subject, and body unless the user has already approved those exact details.
- Do not claim a draft or sent email exists unless the Gmail tool confirms it.

## Workflow

1. Identify email type:
   - supplier PO;
   - customer stock delay;
   - cancellation/refund customer reply;
   - customer tracking/order update;
   - generic order update.
2. Confirm recipient when available.
3. Build subject and body using the relevant skill:
   - `supplier-po-automation` for supplier PO emails;
   - `shopify-stock-delay-customer-workflow` for stock-delay customer emails;
   - `customer-email-reply-drafter` for other customer replies.
4. Create Gmail draft if a Gmail connector/tool is available.
5. Return draft status and the exact subject/body.
6. Route to `shopify-order-note-recorder` when the email should be copied into Shopify.

## Fallback

If Gmail tools are unavailable, prepare the email text and say clearly that no Gmail draft was created.

## Related Gmail reading

Use `gmail-message-finder-safe` instead when the task is to find or read existing supplier/customer emails, such as Sales Confirmation or tracking messages.

See `references/draft-types.md`.
