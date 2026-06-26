# Connector checklist

## Shopify

Use the workspace app `PaintAccess Shopify Operations`, backed by the repo MCP endpoint.

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

Use Daniel/user-owned ChatGPT Gmail app connection. Do not store Gmail OAuth credentials in the backend by default.

Needed abilities:

- create drafts;
- search messages;
- read supplier Sales Confirmation emails;
- read supplier tracking emails;
- optionally send email after Daniel approval.

## Google Drive

Use Daniel/user-owned ChatGPT Google Drive app connection. Needed only if PO files or attachments are stored/generated in Drive.

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
