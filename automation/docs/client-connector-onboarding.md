# Client Connector Onboarding

This document explains what can be stored in Git and what must be authorized separately for the PaintAccess Operations Desk.

## Short answer

The repository can store the automation architecture, skills, setup checklists, and required connector list.

The repository must not store connected accounts, OAuth tokens, refresh tokens, passwords, API keys, or plugin authorizations.

When Daniel or the client pulls this repository, the skills and documentation come with it, but every live account connector still needs to be installed and authorized in that user's Codex workspace/account.

## What Git can safely store

- Skill folders in `skills/`.
- Architecture docs in `docs/`.
- Required connector checklist.
- OAuth setup instructions.
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

- Shopify Admin / Shopify app access.
- Gmail connector for message search, draft creation, confirmations, and tracking.
- Google Drive connector only if PO files/templates/attachments are stored in Drive.
- GitHub connector for repository operations.

## Expected setup flow

1. Pull the repository.
2. Open the workspace in Codex.
3. Install/enable the required plugins or connectors.
4. Authorize each connector with the correct client account.
5. Test read-only operations first:
   - find a Shopify order;
   - find a Gmail message;
   - read a Drive file if Drive is used.
6. Test safe write operations:
   - create Gmail draft;
   - add Shopify note;
   - prepare fulfilment without completing it.

## Google OAuth flow

Use this when a custom Google app is needed instead of a built-in Codex connector:

1. Create a Google Cloud Project.
2. Enable Gmail API.
3. Enable Google Drive API if Drive is needed.
4. Configure OAuth Consent Screen.
5. Create OAuth Client ID as Web Application.
6. Generate the authorization URL.
7. Daniel signs in with the correct Google account and clicks Allow.
8. Store access and refresh tokens only in the approved runtime secret store.

Never put tokens or client secrets in this repository.

## Revoking access

Google access can be revoked from:

```text
Google Account -> Security -> Third-party apps -> Remove Access
```

Codex/plugin access should also be removed from the relevant Codex connector/plugin settings when an account should no longer be used.

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
- OAuth grants;
- connector authorization state;
- refresh tokens;
- plugin installs tied to a specific user/workspace.

Treat connector setup as a per-client environment step, similar to setting production secrets.
