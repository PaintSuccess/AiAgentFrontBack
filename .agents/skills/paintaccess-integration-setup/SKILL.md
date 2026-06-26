---
name: paintaccess-integration-setup
description: guide PaintAccess account and connector setup for Operations Desk automations. use when configuring Shopify, Gmail, Google Drive, OAuth, Google Cloud Project, Codex plugins/connectors, GitHub deployment, token handling, account authorization, or access revocation for the PaintAccess automation project.
---

# PaintAccess Integration Setup

Use this skill when preparing accounts and connectors for Operations Desk automation.

## Required connectors

- Shopify Admin access for orders, products, notes/tags/metafields, fulfilment preparation, and GraphQL fallback.
- Gmail access for supplier/customer drafts and reading supplier confirmations/tracking emails.
- Google Drive access only if PO files, attachments, or shared documents are stored there.
- GitHub access for maintaining and deploying `PaintSuccess/AiAgentFrontBack`.

## Google OAuth setup

Follow this safe setup:

1. Create a Google Cloud Project.
2. Enable Gmail API.
3. Enable Google Drive API if Drive files are needed.
4. Configure OAuth Consent Screen.
5. Create OAuth Client ID as Web Application.
6. Generate an authorization URL.
7. Daniel signs in with the correct Google account and clicks Allow.
8. Store access token and refresh token in the approved runtime secret store, not in repo files.

## Security rules

- Never ask for or store a Google password.
- Do not commit tokens, refresh tokens, client secrets, `.env`, or credentials to GitHub.
- Use least-privilege scopes where possible.
- Access can be revoked from Google Account -> Security -> Third-party apps -> Remove Access.

## Deployment note

This repository stores process knowledge and automation logic. Account authorizations must be connected separately in Codex/plugins/runtime before live automations can act on PaintAccess accounts.

See `references/connector-checklist.md`.
