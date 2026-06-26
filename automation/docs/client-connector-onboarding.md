# Client Connector Onboarding

This document explains what can be stored in Git and what must be authorized separately for the PaintAccess Operations Desk.

## Short answer

The repository can store the automation architecture, skills, setup checklists, and required connector list.

The repository must not store connected accounts, OAuth tokens, refresh tokens, passwords, API keys, or plugin authorizations.

When Daniel or the client pulls this repository, the skills and documentation come with it, but live account access still needs to be authorized in the correct runtime. Shopify is authorized once through the backend MCP secrets. Gmail and Google Drive are authorized by Daniel in ChatGPT Apps.

## What Git can safely store

- Skill folders in `.agents/skills/`.
- Architecture docs in `docs/`.
- Required app/MCP checklist.
- Setup instructions.
- Environment variable names without real values.
- Templates for notes, emails, notifications, and workflows.

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

- Workspace app `PaintAccess Shopify Operations` for Shopify Admin/API operations.
- Daniel/user-owned ChatGPT Gmail app for message search, draft creation, confirmations, and tracking.
- Daniel/user-owned ChatGPT Google Drive app only if PO files/templates/attachments are stored in Drive.
- GitHub connector for repository operations.

## Expected setup flow

1. Pull the repository.
2. Open the workspace in Codex.
3. Confirm the Shopify MCP endpoint is deployed and `SHOPIFY_MCP_TOKEN`, `SHOPIFY_STORE`, and `SHOPIFY_ACCESS_TOKEN` are set in Vercel/runtime secrets.
4. Publish/enable the ChatGPT workspace app `PaintAccess Shopify Operations`.
5. Daniel connects Gmail and Google Drive from ChatGPT Apps using the correct Google account when those apps are needed.
6. Test read-only operations first:
   - find a Shopify order;
   - find a Gmail message;
   - read a Drive file if Drive is used.
7. Test safe write operations:
   - create Gmail draft;
   - add Shopify note;
   - prepare fulfilment without completing it.

## Google app flow

Default path:

1. Daniel opens ChatGPT in the PaintAccess workspace.
2. Daniel opens Apps and connects Gmail.
3. Daniel connects Google Drive only if Drive files/templates are needed.
4. The Operations Desk agent uses those apps only when Daniel's ChatGPT account/session has access.

Do not create a custom Google Cloud OAuth app or store Google refresh tokens in the backend unless Daniel explicitly changes the architecture.

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
- OAuth grants and ChatGPT app authorizations;
- connector authorization state;
- refresh tokens;
- plugin installs tied to a specific user/workspace.

Treat connector setup as a per-client environment step, similar to setting production secrets.
