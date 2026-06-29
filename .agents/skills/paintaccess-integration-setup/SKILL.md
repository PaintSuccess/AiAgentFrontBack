---
name: paintaccess-integration-setup
description: guide PaintAccess account and connector setup for Operations Desk automations. use when configuring the PaintAccess Operations MCP, Shopify, backend Gmail and Google Drive OAuth, GitHub deployment, token handling, account authorization, access revocation, or connector rollout for the PaintAccess automation project.
---

# PaintAccess Integration Setup

Use this skill when preparing accounts and connectors for Operations Desk automation.

## Required connectors

- Workspace app `PaintAccess Operations`, backed by the repo MCP endpoint, for Shopify orders, products, notes/tags/metafields, fulfilment preparation, cancellation preparation, email templates, Gmail, and Google Drive.
- Backend Gmail access through Google OAuth env secrets for supplier/customer drafts, sends after approval, and reading supplier confirmations/tracking emails.
- Backend Google Drive access through Google OAuth env secrets if PO files, attachments, or shared documents are stored there.
- GitHub access for maintaining and deploying `PaintSuccess/AiAgentFrontBack`.

## Google backend setup

Gmail and Drive use backend OAuth for this project. Do not ask for Google passwords or store credentials in Git. Prefer the admin helper flow over manual token handling:

1. Confirm `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set in Vercel.
2. Open `https://ai-agent-front-back.vercel.app/api/google/oauth-start?pin=...`.
3. Authorize with the PaintAccess Gmail/Drive account that should own drafts/files.
4. On callback, confirm whether Vercel auto-store completed. If not, copy the displayed refresh token into Vercel as `GOOGLE_REFRESH_TOKEN`.
5. Redeploy production if no deploy hook was triggered.

Runtime secrets:

1. `GOOGLE_CLIENT_ID`
2. `GOOGLE_CLIENT_SECRET`
3. `GOOGLE_REFRESH_TOKEN`
4. Optional `GOOGLE_WORKSPACE_EMAIL`
5. Optional `GOOGLE_OAUTH_ADMIN_PIN`
6. Optional Vercel auto-store values: `VERCEL_API_TOKEN`, `VERCEL_PROJECT_ID_OR_NAME`, `VERCEL_TEAM_ID` or `VERCEL_TEAM_SLUG`, and `VERCEL_DEPLOY_HOOK_URL`

## Shopify MCP setup

1. Deploy the repo endpoint `api/mcp/shopify.js`.
2. Confirm the Shopify app active version includes required Admin API scopes for MCP operations: `read_orders`, `write_orders`, `read_customers`, `write_customers`, `read_draft_orders`, `write_draft_orders`, `read_fulfillments`, `write_fulfillments`, `read_merchant_managed_fulfillment_orders`, `write_merchant_managed_fulfillment_orders`, `read_products`, and `read_inventory`.
3. Open `https://ai-agent-front-back.vercel.app/api/shopify/oauth-start` and approve app reauthorization in Shopify Admin.
4. On callback, confirm whether Vercel auto-store completed. If not, copy the displayed token into Vercel as `SHOPIFY_ACCESS_TOKEN`.
5. Redeploy production if no deploy hook was triggered.
6. Keep `SHOPIFY_MCP_TOKEN`, `SHOPIFY_STORE`, and `SHOPIFY_ACCESS_TOKEN` in Vercel/runtime secrets.
7. Keep `MCP_OAUTH_TOKEN_SECRET` and optional `MCP_OAUTH_PIN` in Vercel/runtime secrets.
8. Publish the workspace app `PaintAccess Operations` as a custom OAuth MCP app.
9. Attach the app to the Operations Desk agent.
10. Restrict final fulfilment, cancellation, refund, email sending, and supplier payment actions behind Daniel approval.

## Security rules

- Never ask for or store a Google password.
- Do not commit tokens, refresh tokens, client secrets, `.env`, or credentials to GitHub.
- Use least-privilege scopes where possible.
- Google access can be revoked from Google Account -> Security -> Third-party apps -> Remove Access, and by removing `GOOGLE_REFRESH_TOKEN` from Vercel.
- Shopify access can be revoked by uninstalling/reinstalling the Shopify app or rotating `SHOPIFY_ACCESS_TOKEN` through `/api/shopify/oauth-start`.
- Vercel auto-store is optional. If it is not configured, callback pages may display sensitive tokens once for manual copy into Vercel; close those pages after updating secrets.

## Deployment note

This repository stores process knowledge and automation logic. Account authorizations must be connected separately in the runtime before live automations can act on PaintAccess accounts: Shopify through backend Shopify secrets, Gmail/Drive through backend Google OAuth secrets, and ChatGPT through the OAuth MCP app authorization.

See `references/connector-checklist.md`.
