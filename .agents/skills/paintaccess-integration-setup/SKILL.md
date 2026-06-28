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

Gmail and Drive use backend OAuth for this project. Do not ask for Google passwords or store credentials in Git. Store only runtime secrets in Vercel:

1. `GOOGLE_CLIENT_ID`
2. `GOOGLE_CLIENT_SECRET`
3. `GOOGLE_REFRESH_TOKEN`
4. Optional `GOOGLE_WORKSPACE_EMAIL`

## Shopify MCP setup

1. Deploy the repo endpoint `api/mcp/shopify.js`.
2. Keep `SHOPIFY_MCP_TOKEN`, `SHOPIFY_STORE`, and `SHOPIFY_ACCESS_TOKEN` in Vercel/runtime secrets.
3. Keep `MCP_OAUTH_TOKEN_SECRET` and optional `MCP_OAUTH_PIN` in Vercel/runtime secrets.
4. Publish the workspace app `PaintAccess Operations` as a custom OAuth MCP app.
5. Attach the app to the Operations Desk agent.
6. Restrict final fulfilment, cancellation, refund, email sending, and supplier payment actions behind Daniel approval.

## Security rules

- Never ask for or store a Google password.
- Do not commit tokens, refresh tokens, client secrets, `.env`, or credentials to GitHub.
- Use least-privilege scopes where possible.
- Google access can be revoked from Google Account -> Security -> Third-party apps -> Remove Access, and by removing `GOOGLE_REFRESH_TOKEN` from Vercel.

## Deployment note

This repository stores process knowledge and automation logic. Account authorizations must be connected separately in the runtime before live automations can act on PaintAccess accounts: Shopify through backend Shopify secrets, Gmail/Drive through backend Google OAuth secrets, and ChatGPT through the OAuth MCP app authorization.

See `references/connector-checklist.md`.
