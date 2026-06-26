---
name: paintaccess-integration-setup
description: guide PaintAccess account and connector setup for Operations Desk automations. use when configuring the PaintAccess Shopify Operations MCP, Daniel-owned ChatGPT Gmail and Google Drive apps, GitHub deployment, token handling, account authorization, access revocation, or connector rollout for the PaintAccess automation project.
---

# PaintAccess Integration Setup

Use this skill when preparing accounts and connectors for Operations Desk automation.

## Required connectors

- Workspace app `PaintAccess Shopify Operations`, backed by the repo MCP endpoint, for Shopify orders, products, notes/tags/metafields, fulfilment preparation, and cancellation preparation.
- Gmail access through Daniel/user-owned ChatGPT Apps for supplier/customer drafts and reading supplier confirmations/tracking emails.
- Google Drive access through Daniel/user-owned ChatGPT Apps only if PO files, attachments, or shared documents are stored there.
- GitHub access for maintaining and deploying `PaintSuccess/AiAgentFrontBack`.

## Google app setup

Do not build or store Gmail/Drive OAuth credentials in the backend unless Daniel explicitly changes the architecture. The default approach is:

1. Daniel opens ChatGPT in the PaintAccess workspace.
2. Daniel connects Gmail and Google Drive from ChatGPT Apps using the correct Google account.
3. Agents use those apps only when Daniel's ChatGPT session/account has access.
4. Do not ask Daniel for Google passwords, refresh tokens, or client secrets.

## Shopify MCP setup

1. Deploy the repo endpoint `api/mcp/shopify.js`.
2. Keep `SHOPIFY_MCP_TOKEN`, `SHOPIFY_STORE`, and `SHOPIFY_ACCESS_TOKEN` in Vercel/runtime secrets.
3. Publish the workspace app `PaintAccess Shopify Operations` as a custom MCP app.
4. Attach the app to the Operations Desk agent.
5. Restrict final fulfilment, cancellation, refund, email sending, and supplier payment actions behind Daniel approval.

## Security rules

- Never ask for or store a Google password.
- Do not commit tokens, refresh tokens, client secrets, `.env`, or credentials to GitHub.
- Use least-privilege scopes where possible.
- Access can be revoked from Google Account -> Security -> Third-party apps -> Remove Access.

## Deployment note

This repository stores process knowledge and automation logic. Account authorizations must be connected separately in the runtime before live automations can act on PaintAccess accounts: Shopify through the workspace MCP app, and Gmail/Drive through Daniel-owned ChatGPT Apps.

See `references/connector-checklist.md`.
