# Client Connector Onboarding

This document explains what can be stored in Git and what must be authorized separately for the PaintAccess Operations Desk.

## Short answer

The repository can store the automation architecture, skills, setup checklists, and required connector list.

The repository must not store connected accounts, OAuth tokens, refresh tokens, passwords, API keys, or plugin authorizations.

When Daniel or the client pulls this repository, the skills and documentation come with it, but live account access still needs to be authorized in the correct runtime. Shopify is authorized once through backend MCP secrets. Gmail and Google Drive are authorized through backend Google OAuth secrets and exposed to ChatGPT through the same PaintAccess Operations MCP.

## What Git can safely store

- Skill folders in `.agents/skills/`.
- Architecture docs in `docs/`.
- Required app/MCP checklist.
- Setup instructions.
- Environment variable names without real values.
- Templates for timeline entries, emails, notifications, and workflows.

## What Git must not store

- Google passwords.
- Shopify passwords.
- Gmail OAuth access tokens.
- Gmail OAuth refresh tokens.
- Shopify access tokens.
- Google OAuth client secrets.
- `.env` files with real values.
- Any credential export from Codex, Google Cloud, Shopify, or GitHub.

## Required connectors

Minimum production connector set:

- Workspace app `PaintAccess Operations` for Shopify Admin/API, Gmail, and Drive operations.
- Backend-authorized Gmail tools in `PaintAccess Operations` for message search, draft creation, confirmations, tracking, and approved sending.
- Backend-authorized Google Drive tools in `PaintAccess Operations` only if PO files/templates/attachments are stored in Drive.
- GitHub connector for repository operations.

## Expected setup flow

1. Pull the repository.
2. Open the workspace in Codex.
3. Confirm the Shopify MCP endpoint is deployed and `SHOPIFY_MCP_TOKEN`, `SHOPIFY_STORE`, and `SHOPIFY_ACCESS_TOKEN` are set in Vercel/runtime secrets.
4. Publish/enable the ChatGPT workspace app `PaintAccess Operations`.
5. Configure backend Google OAuth env secrets when Gmail or Drive tools are needed: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`.
   - Preferred: open `/api/google/oauth-start?pin=...` and let the callback store `GOOGLE_REFRESH_TOKEN` in Vercel.
   - Fallback: copy the callback refresh token into Vercel manually.
6. Test read-only operations first:
   - find a Shopify order;
   - find a Gmail message;
   - read a Drive file if Drive is used.
7. Test safe write operations:
   - create Gmail draft;
   - record Shopify timeline entry;
   - prepare fulfilment without completing it.

## Google backend flow

Default path:

1. Create or use a Google OAuth client for the PaintAccess operations Google account.
2. Open `/api/google/oauth-start?pin=...`.
3. Authorize Gmail and Drive scopes for the account that should own drafts/files.
4. Let the callback store `GOOGLE_REFRESH_TOKEN` in Vercel, or copy it manually if Vercel auto-store is not configured.
5. Redeploy production if no deploy hook is configured.
6. The Operations Desk agent uses Gmail/Drive only through the PaintAccess Operations MCP.

## Shopify backend flow

Default path:

1. Add required Admin API scopes in the Shopify app dev dashboard.
2. Release the new Shopify app version if Shopify requires version submission.
3. Open `/api/shopify/oauth-start`.
4. Approve the app reauthorization in Shopify Admin.
5. Let the callback store `SHOPIFY_ACCESS_TOKEN` in Vercel, or copy it manually if Vercel auto-store is not configured.
6. Redeploy production if no deploy hook is configured.

Do not put Google passwords, OAuth client secrets, access tokens, or refresh tokens in Git.

## Revoking access

Google access can be revoked from:

```text
Google Account -> Security -> Third-party apps -> Remove Access
```

ChatGPT App access should also be removed from the relevant ChatGPT app settings when an account should no longer be used.

## Portability model

Portable through Git:

- workflows;
- skills;
- prompts;
- checklists;
- templates;
- architecture.

Not portable through Git:

- account sessions;
- OAuth grants and ChatGPT MCP app authorizations;
- connector authorization state;
- refresh tokens;
- plugin installs tied to a specific user/workspace.

Treat connector setup as a per-client environment step, similar to setting production secrets.
