# Codex Instructions - Paint Access AI Support App

These instructions adapt the existing GitHub Copilot project workflow for Codex. Keep `.github/` untouched so GitHub Copilot can continue using its own setup.

## Project Overview

- Frontend: React 18 and Shopify Polaris, served as an embedded Shopify app.
- Backend: Vercel serverless functions under `api/`.
- AI agent: ElevenLabs Conversational AI, currently `agent_1001kn99pk1xefprh4gb665f6j3p`.
- Production backend: `https://ai-agent-front-back.vercel.app`.
- Shopify store: `zgmzge-0d.myshopify.com` for `paintaccess.com.au`.

## Working Rules

- Treat `.env`, API keys, tokens, Shopify credentials, ElevenLabs keys, Twilio secrets, and Vercel values as secrets.
- Do not edit `.github/` when making Codex workflow changes.
- Preserve unrelated user changes. Check `git status --short` before editing and avoid reverting files you did not change.
- Use the existing stack and patterns: Vite, React, Polaris, CommonJS serverless handlers, and helpers under `lib/`.
- For frontend work, use `dashboardFetch()` from `src/utils/fetch.js` for dashboard API calls so the Shopify App Bridge JWT is attached.

## Knowledge Base Sync

`kb-docs/` is the local mirror of the ElevenLabs Knowledge Base used in live customer conversations. Before reading, editing, or suggesting changes to any file under `kb-docs/`, run:

```powershell
cd "C:\Active Projects\Shopify-PaintAccess-Site\app"
.\kb-docs\sync-pull.ps1
```

Only inspect or edit KB files after the sync finishes successfully. After changing a KB document, push it back through the Shopify admin KB editor or the dashboard API:

```http
PATCH /api/dashboard/knowledge-base
Body: { id, name, content, usage_mode }
```

This prevents overwriting client edits made through the Shopify admin UI.

## KB Documents

| File | usage_mode | Purpose |
| --- | --- | --- |
| `Bot Behavior Rules.md` | prompt | Core agent personality and rules |
| `Company Information.md` | prompt | Business details, contact, hours |
| `Excluded Products & Restrictions.md` | prompt | Products not to recommend or sell |
| `Product Knowledge & Painting Guides.md` | auto | How-to guides and product specs |
| `Paint Sprayers Trouble-Shoot.md` | auto | Troubleshooting guide |
| `Product Recommendation Rules.md` | auto | Cross-sell and upsell logic |
| `Conversation & Estimation Logic paint calculation.md` | auto | Paint quantity calculations |

## Key Files

| Path | Purpose |
| --- | --- |
| `api/shopify/inventory.js` | Real-time stock checks |
| `api/shopify/products.js` | Product search for the agent |
| `api/shopify/order.js` | Order lookup |
| `api/dashboard/knowledge-base.js` | CRUD proxy for ElevenLabs KB |
| `api/comms/*.js` | Inbox endpoints: threads, thread, contact, send, control, call |
| `lib/comms/{store,queries,send}.js` | Comms spine: write / read / send layers |
| `lib/dashboard-auth.js` | HMAC/JWT auth helpers for dashboard APIs |
| `src/pages/InboxPage.jsx` | Unified communications inbox UI |
| `src/pages/KnowledgeBasePage.jsx` | KB editor UI |
| `src/App.jsx` | App shell, routing, and navigation |

## Inventory Availability

Never use `inventoryQuantity > 0` alone as the availability check. For this store, `inventoryPolicy: CONTINUE` means the product is orderable even when quantity is zero or negative. Use the `available` field returned by `api/shopify/inventory.js` and `api/shopify/products.js`.

## Commands

```powershell
npm run dev
npm run build
npm run preview
```

Run `npm run build` after code changes that affect runtime behavior or frontend compilation. Documentation-only Codex workflow updates do not require a build.
