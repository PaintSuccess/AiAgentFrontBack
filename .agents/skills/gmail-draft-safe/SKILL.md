---
name: gmail-draft-safe
description: create or prepare safe PaintAccess Gmail drafts for customers or suppliers from Shopify workflows. use when the user asks to create a Gmail draft, draft supplier PO email, draft customer stock-delay email, prepare an email for review, send an email only after confirmation, or record an email copy back to Shopify.
---

# Gmail Draft Safe

Use this skill for PaintAccess Gmail draft creation from Shopify operations. For customer order-status or note-change notifications, prefer `shopify_send_customer_email` through the PaintAccess Operations MCP unless the user explicitly asks for Gmail or Shopify native sending is unavailable.

## Connector rule

Use Gmail through the PaintAccess Operations MCP backend tools: `gmail_create_draft` for drafts and `gmail_send_email` only after Daniel approval. Do not ask for Google passwords, OAuth client secrets, access tokens, or refresh tokens. If backend Google credentials are not configured, prepare the email text only and clearly state that no Gmail draft was created.

## Core rules

- Create drafts for review by default.
- Do not send email unless the user explicitly asks to send and the available Gmail tool supports it.
- If sending, confirm recipient, subject, and body unless the user has already approved those exact details.
- Do not claim a draft or sent email exists unless the Gmail tool confirms it.
- Do not use Gmail as the default channel for customer note/status notifications; Shopify native email carries the store branding/footer.

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
4. Create Gmail draft with `gmail_create_draft` when backend Google credentials are available.
5. Return draft status and the exact subject/body.
6. Route to `shopify-order-note-recorder` when the email should be copied into Shopify.

## Fallback

If Gmail tools are unavailable, prepare the email text and say clearly that no Gmail draft was created.

## Related Gmail reading

Use `gmail-message-finder-safe` instead when the task is to find or read existing supplier/customer emails, such as Sales Confirmation or tracking messages.

See `references/draft-types.md`.
