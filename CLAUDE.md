# Claude Project Memory - Paint Access AI Support App

## ⚠ PENDING FOLLOW-UPS (check every session, remove line once done)

- **ChatGPT agent instructions are stale.** As of 2026-07-08, `app/.agents/skills/shopify-ops-orchestrator/SKILL.md`, `shopify-order-timeline-recorder/SKILL.md`, and `shopify-graphql-safe-mutation/SKILL.md` were updated to describe a real server-side approval gate (an `ops-approved` Shopify order tag, replacing the old "any non-empty approval_reference string" behavior) and to remove a phantom GraphQL-execution tool reference. If the live "PaintAccess Operations Desk" ChatGPT agent's Instructions field was hand-copied from these files, **it is now out of date and does not reflect what the MCP server actually enforces.** Daniel/the user lost ChatGPT browser authorization at the time of this fix and could not update it live. **Next session: ask whether ChatGPT access is back, and if so, walk through re-syncing the agent's Instructions field from the current SKILL.md content.**

Use this file as Claude's project memory. It mirrors the Codex environment for this repo while keeping GitHub Copilot and Codex-specific files intact.

Also read `AGENTS.md` before changing application files. Do not edit `.github/` for Claude or Codex workflow changes.

## Project Overview

- Frontend: React 18 and Shopify Polaris, served as an embedded Shopify app.
- Backend: Vercel serverless functions under `api/`.
- AI agent: ElevenLabs Conversational AI, currently `agent_1001kn99pk1xefprh4gb665f6j3p`.
- Production backend: `https://ai-agent-front-back.vercel.app`.
- Shopify store: `zgmzge-0d.myshopify.com` for `paintaccess.com.au`.
- Theme/widget files: tracked under `_store/theme/`, especially `_store/theme/snippets/ai-support-widget.liquid`.
- Operations/agent automation: `automation/`, `.agents/skills/`, and `.codex/skills/`.

## Working Rules

- Check `git status --short` before editing. Preserve unrelated user changes.
- Treat `.env`, API keys, tokens, Shopify credentials, ElevenLabs keys, Twilio secrets, Google OAuth values, Vercel values, and recovery codes as secrets.
- Keep `.github/` untouched so GitHub Copilot can continue using its own setup.
- Use existing patterns: Vite, React, Polaris, CommonJS serverless handlers, and helpers under `lib/`.
- For frontend dashboard API calls, use `dashboardFetch()` from `src/utils/fetch.js` so the Shopify App Bridge JWT is attached.
- Run `npm run build` after code changes that affect runtime behavior or frontend compilation. Documentation-only workflow updates do not require a build.

## Knowledge Base Sync

`kb-docs/` is the local mirror of the live ElevenLabs Knowledge Base used in customer conversations.

Before reading, editing, or suggesting changes to files under `kb-docs/`, run:

```powershell
cd "C:\Active Projects\Shopify-PaintAccess-Site\app"
.\kb-docs\sync-pull.ps1
```

Only inspect or edit KB files after the sync succeeds. After changing a KB document, push it back through the Shopify admin KB editor or the dashboard API:

```http
PATCH /api/dashboard/knowledge-base
Body: { id, name, content, usage_mode }
```

This prevents overwriting client edits made through the Shopify admin UI.

## Inventory Availability

Never use `inventoryQuantity > 0` alone as the availability check. For this store, `inventoryPolicy: CONTINUE` means the product is orderable even when quantity is zero or negative. Use the `available` field returned by `api/shopify/inventory.js` and `api/shopify/products.js`.

## Key Files

| Path | Purpose |
| --- | --- |
| `api/shopify/inventory.js` | Real-time stock checks |
| `api/shopify/products.js` | Product search for the agent |
| `api/shopify/order.js` | Order lookup |
| `api/dashboard/knowledge-base.js` | CRUD proxy for ElevenLabs KB |
| `api/comms/*.js` | Inbox endpoints: threads, thread, contact, send, control, call |
| `lib/comms/{store,queries,send,call,mcp-tools}.js` | Comms spine: write/read/send/call layers + ChatGPT MCP tools |
| `supabase/migrations/` | Comms spine schema (contacts/threads/messages/voice_calls/events) |
| `lib/dashboard-auth.js` | HMAC/JWT auth helpers for dashboard APIs |
| `src/pages/InboxPage.jsx` | Unified communications inbox UI (+ `src/pages/inbox.css`) |
| `src/pages/KnowledgeBasePage.jsx` | KB editor UI |
| `src/App.jsx` | App shell, routing, and navigation |
| `_store/theme/snippets/ai-support-widget.liquid` | Shopify storefront widget snippet |
| `api/mcp/shopify.js` | PaintAccess Operations MCP endpoint |
| `api/callback.js` | Outbound AI callback (draft order + live ElevenLabs call). **Disabled by default** (`ENABLE_AI_CALLBACK` unset) — not wired to any UI, and needs a product/compliance decision (consent capture, Do Not Call Register) before re-enabling. |

## Commands

```powershell
npm run dev
npm run build
npm run preview
npm run test:search
npm run test:text-orders
npm run test:text-agent
npm run test:display-sequence
```

## Claude Skill Routing

Claude should use the same source skills that Codex and the ChatGPT agents use. Do not rewrite or duplicate a skill unless the user asks to evolve the workflow.

- Project workflow skill: `.codex/skills/paint-access-codex-workflow/SKILL.md`.
- Operations Desk and agent skills: `.agents/skills/*/SKILL.md`.
- Claude bridge skill: `.claude/skills/paintaccess-claude-workflow/SKILL.md`.

When a task matches a skill, read the matching `SKILL.md` fully before acting. If it references files under `references/`, read only the relevant referenced files.

Important operations skills include:

| Skill | Use For |
| --- | --- |
| `shopify-ops-orchestrator` | End-to-end PaintAccess Operations Desk workflows |
| `shopify-order-lookup-safe` | Safe order identification before downstream actions |
| `shopify-order-timeline-recorder` | Internal Shopify timeline entries, tags, and status markers |
| `shopify-graphql-safe-mutation` | Safe Shopify Admin GraphQL writes only when no narrow tool exists |
| `supplier-po-automation` | Supplier purchase order preparation from Shopify orders |
| `supplier-sales-confirmation-checker` | Checking supplier confirmations against orders/POs |
| `supplier-payment-approval-recorder` | Daniel approval/payment status workflows |
| `supplier-tracking-fulfillment-prep` | Tracking and fulfilment preparation without final fulfilment |
| `gmail-message-finder-safe` | Safe Gmail search for supplier/customer messages |
| `gmail-draft-safe` | Gmail drafts/sends after approval |
| `drive-file-finder-safe` | Google Drive lookup for order documents and supplier files |
| `paintaccess-integration-setup` | Connector/OAuth/runtime setup |
| `shopify-flow-skill-evolver` | Post-operation workflow improvement proposals |

## Operations Desk Rules

- Prefer the PaintAccess Operations MCP/backend endpoint for Shopify, Gmail, and Drive operations when available.
- Do not claim a Gmail draft, Drive file, Shopify email, fulfilment, tag, metafield, or timeline entry was created unless the relevant tool confirms it.
- Never cancel, refund, delete, fulfill, financially modify an order, send supplier/customer emails, or approve/process supplier payments without explicit Daniel/user approval and an appropriate safe tool.
- Shopify Inbox is not currently exposed by the PaintAccess Operations MCP. Offer Gmail/order lookup/manual checklist alternatives unless the user explicitly asks for browser-based manual work.

## Claude Connector Setup

Live account access is not portable through Git. Claude can read the skills and project memory from this repository, but Shopify/Gmail/Drive access must be configured separately in the runtime.

- Do not commit Claude MCP tokens or account session files.
- Use `automation/docs/client-connector-onboarding.md` and `.agents/skills/paintaccess-integration-setup/SKILL.md` when setting up connector access.
- Initial private MCP endpoint pattern documented in the repo: `https://ai-agent-front-back.vercel.app/api/mcp/shopify?token={SHOPIFY_MCP_TOKEN}`.
- Store real `SHOPIFY_MCP_TOKEN`, Shopify, Google, and Vercel secrets only in approved runtime/user-local secret stores.

## Formal Project Split

- Boris Does/AWS: separate Amazon-hosted project; leave it alone for now.
- ChatGPT agents/Operations Desk: separate formal agent automation project, stored here in `automation/` and `.agents/`; Claude should follow the same workflows as Codex.
- Shopify app/backend/widget/frontend theme: separate formal product project, currently together in this repo under `api/`, `src/`, `lib/`, and `_store/theme/`.
