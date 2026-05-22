---
name: paint-access-codex-workflow
description: Project workflow for the Paint Access Shopify AI support app. Use when Codex works in this repository on React/Polaris dashboard code, Vercel serverless APIs, Shopify Admin API integration, ElevenLabs Conversational AI tools, Twilio webhooks, or Knowledge Base files under kb-docs.
---

# Paint Access Codex Workflow

## Overview

Use this skill to apply the project rules that were originally written for GitHub Copilot in a Codex-friendly workflow. Keep the GitHub Copilot setup in `.github/` untouched.

## Start Here

- Check `git status --short` before editing. Preserve unrelated user changes.
- Treat `.env`, API keys, tokens, Shopify credentials, ElevenLabs keys, Twilio secrets, and Vercel values as secrets.
- Prefer existing project patterns: Vite, React 18, Shopify Polaris, CommonJS serverless handlers, and helpers under `lib/`.
- For dashboard API calls from the frontend, use `dashboardFetch()` from `src/utils/fetch.js` so the Shopify App Bridge session token is attached.

## Knowledge Base Rule

`kb-docs/` is a local mirror of the live ElevenLabs Knowledge Base used in customer conversations. Before reading, editing, or suggesting changes to any file under `kb-docs/`, run:

```powershell
cd "C:\Active Projects\Shopify-PaintAccess-Site\app"
.\kb-docs\sync-pull.ps1
```

Only inspect or edit KB files after the sync finishes. After editing, push changes through the Shopify admin KB editor or:

```http
PATCH /api/dashboard/knowledge-base
Body: { id, name, content, usage_mode }
```

This prevents overwriting client edits made through the Shopify admin UI.

## Project Map

- `api/shopify/inventory.js`: Real-time stock checks.
- `api/shopify/products.js`: Product search for the agent.
- `api/shopify/order.js`: Order lookup.
- `api/dashboard/knowledge-base.js`: CRUD proxy for ElevenLabs KB.
- `api/dashboard/conversations.js`: Conversation history proxy.
- `api/dashboard/conversation.js`: Single conversation details.
- `lib/dashboard-auth.js`: HMAC/JWT auth helpers for dashboard APIs.
- `src/pages/KnowledgeBasePage.jsx`: KB editor UI.
- `src/App.jsx`: App shell, routing, and navigation.

## Inventory Availability

Never use `inventoryQuantity > 0` alone as the availability check. For this store, `inventoryPolicy: CONTINUE` means the product is orderable even when quantity is zero or negative. Use the `available` field returned by `api/shopify/inventory.js` and `api/shopify/products.js`.

## Validation

Use `npm run build` after code changes that affect runtime behavior or frontend compilation. Documentation-only workflow edits do not require a build.
