# Connector checklist

## Shopify

Use the workspace app `PaintAccess Operations`, backed by the repo MCP endpoint.

Expected tools:

- `shopify_search_orders`;
- `shopify_get_order`;
- `shopify_get_fulfillment_readiness`;
- `shopify_add_order_note`;
- `shopify_add_order_tag`;
- `shopify_remove_order_tag`;
- `shopify_set_ops_metafield`;
- `shopify_prepare_fulfillment`;
- `shopify_prepare_cancellation`.

## Gmail

Use backend-authorized Gmail tools in the PaintAccess Operations MCP. Store Google OAuth credentials only in Vercel/runtime secrets.

Needed abilities:

- create drafts;
- search messages;
- read supplier Sales Confirmation emails;
- read supplier tracking emails;
- optionally send email after Daniel approval.

## Google Drive

Use backend-authorized Google Drive tools in the PaintAccess Operations MCP. Needed only if PO files or attachments are stored/generated in Drive.

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
