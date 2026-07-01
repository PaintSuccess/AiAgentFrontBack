# Connector checklist

## Shopify

Use the workspace app `PaintAccess Operations`, backed by the repo MCP endpoint.

Authorization setup:

- Active Shopify app version must include `write_orders` for order timeline-entry recording compatibility and existing-order invoice email, customer, draft order fallback, and fulfillment scopes needed by the MCP.
- Reauthorize through `https://ai-agent-front-back.vercel.app/api/shopify/oauth-start` after changing scopes.
- The callback should store `SHOPIFY_ACCESS_TOKEN` in Vercel automatically when Vercel auto-store env vars are configured; otherwise copy the shown token into Vercel manually.

Expected tools:

- `shopify_search_orders`;
- `shopify_get_order`;
- `shopify_get_fulfillment_readiness`;
- `shopify_record_order_timeline_entry`;
- `shopify_remove_order_note_entry`;
- `shopify_add_order_tag`;
- `shopify_remove_order_tag`;
- `shopify_set_ops_metafield`;
- `shopify_prepare_fulfillment`;
- `shopify_prepare_cancellation`;
- `shopify_prepare_customer_email`;
- `shopify_send_customer_email`.

## Gmail

Use backend-authorized Gmail tools in the PaintAccess Operations MCP. Store Google OAuth credentials only in Vercel/runtime secrets.

Authorization setup:

- Confirm `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are in Vercel.
- Authorize through `https://ai-agent-front-back.vercel.app/api/google/oauth-start?pin=...`.
- The callback should store `GOOGLE_REFRESH_TOKEN` in Vercel automatically when Vercel auto-store env vars are configured; otherwise copy the shown refresh token into Vercel manually.

Needed abilities:

- create drafts;
- search messages;
- read supplier Sales Confirmation emails;
- read supplier tracking emails;
- optionally send email after Daniel approval.

## Google Drive

Use backend-authorized Google Drive tools in the PaintAccess Operations MCP. Needed only if PO files or attachments are stored/generated in Drive.

Authorization uses the same `/api/google/oauth-start?pin=...` flow as Gmail, with Drive scopes included by the backend.

Needs access to:

- create files;
- read selected PO templates/files;
- attach/export PO documents if required.

## GitHub

Target repository:

```text
PaintSuccess/AiAgentFrontBack
```

Do not publish secrets or local credential files.
