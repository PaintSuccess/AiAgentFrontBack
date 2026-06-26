# PaintAccess Shopify Operations MCP Install

This document explains how Daniel or a PaintAccess workspace admin can install the private Shopify Operations MCP in ChatGPT.

## What this connector does

The connector gives ChatGPT Workspace Agents narrow Shopify operations that the built-in Shopify app does not expose reliably enough for Operations Desk workflows.

It supports:

- searching Shopify orders;
- reading operational order details;
- checking fulfilment readiness;
- appending controlled internal order notes;
- adding/removing controlled process tags;
- setting controlled `paintaccess_ops` metafields;
- preparing fulfilment previews without final fulfilment;
- preparing cancellation/refund reports without cancelling or refunding.

It does not handle Gmail or Google Drive. The client should continue using ChatGPT's built-in Gmail and Google Drive apps for those.

## Production endpoint

After deployment, the MCP endpoint is:

```text
https://ai-agent-front-back.vercel.app/api/mcp/shopify?token={SHOPIFY_MCP_TOKEN}
```

Replace `{SHOPIFY_MCP_TOKEN}` with the value configured in Vercel.

Do not share this URL publicly. Until OAuth is implemented, the tokenized URL is the private install credential.

## Required Vercel environment variables

```text
SHOPIFY_STORE=zgmzge-0d.myshopify.com
SHOPIFY_ACCESS_TOKEN=...
SHOPIFY_ADMIN_API_VERSION=2026-04
SHOPIFY_MCP_TOKEN=...
SHOPIFY_MCP_ALLOW_UNAUTHENTICATED=false
```

Use a long random value for `SHOPIFY_MCP_TOKEN`.

## ChatGPT setup

1. Deploy the backend to Vercel.
2. Open ChatGPT web.
3. Go to `Settings -> Apps & Connectors -> Advanced settings`.
4. Enable developer mode if the workspace allows it.
5. Go to `Settings -> Apps & Connectors` or `Settings -> Connectors`.
6. Click `Create`.
7. Use:

```text
Connector name:
PaintAccess Shopify Operations

Description:
Narrow Shopify operations for PaintAccess Operations Desk: order lookup, order notes, controlled process tags, fulfilment preparation, and cancellation/refund preparation. Gmail and Drive remain handled by built-in ChatGPT apps.

Connector URL:
https://ai-agent-front-back.vercel.app/api/mcp/shopify?token={SHOPIFY_MCP_TOKEN}
```

8. Click `Create`.
9. Confirm ChatGPT lists the Shopify tools.
10. Add the connector to `PaintAccess Operations Desk`.
11. Keep `PaintAccess Read-only Monitor` limited to read tools only.

## Recommended ChatGPT permissions

For Daniel/admin:

```text
Ask before making changes
```

For wider staff rollout:

```text
Always ask
```

Mandatory Daniel confirmation should remain required for:

- sending supplier/customer emails;
- approving or processing payments;
- cancelling orders;
- issuing refunds;
- completing final Shopify fulfilment;
- overriding duplicate PO protection.

## First tests

Use a known safe order.

Read-only:

```text
Use PaintAccess Shopify Operations to search for order #44478.
```

```text
Get fulfilment readiness for order #44478, but do not change anything.
```

Safe write:

```text
Add an internal Shopify note to order #44478 saying this is a connector test note only.
```

Controlled tag:

```text
Add the tag "Manual action required" to order #44478 with reason "connector test".
```

Preparation-only:

```text
Prepare a cancellation/refund report for order #44478. Do not cancel or refund.
```

## Current private rollout limitation

This first implementation uses a private tokenized MCP URL. It is suitable for a controlled PaintAccess rollout where only Daniel/admins receive the URL.

For broad workspace or public distribution, replace the URL token with proper OAuth for the MCP server before publishing.

