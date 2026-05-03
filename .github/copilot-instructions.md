# Copilot Instructions — AI Agent Front/Back (Paint Access)

## Project overview

- **Frontend:** React 18 + Shopify Polaris, served as embedded Shopify app
- **Backend:** Vercel serverless functions under `api/`
- **AI agent:** ElevenLabs Conversational AI (`agent_1001kn99pk1xefprh4gb665f6j3p`)
- **Deployed at:** `https://ai-agent-front-back-eta.vercel.app`
- **Shopify store:** `zgmzge-0d.myshopify.com` (paintaccess.com.au)

---

## CRITICAL — KB documents: always sync before editing

The folder `kb-docs/` contains a **local mirror** of the ElevenLabs Knowledge Base documents.
These files are what the AI agent uses for context in every customer conversation.

**Before reading, editing, or suggesting changes to any file in `kb-docs/`:**

1. Run the sync script to pull the latest version from ElevenLabs:
   ```powershell
   cd "C:\Active Projects\AiAgentFrontBack"
   .\kb-docs\sync-pull.ps1
   ```
2. Only then open or edit the file.
3. After editing, push the change back via the **Shopify admin KB editor**
   (sidebar → Knowledge Base → edit the doc), or via:
   ```
   PATCH /api/dashboard/knowledge-base
   Body: { id, name, content, usage_mode }
   ```

Editing a local file without syncing first risks overwriting changes the client made through the Shopify admin UI.

### KB documents (7 total)

| File | usage_mode | Purpose |
|------|-----------|---------|
| `Bot Behavior Rules.md` | prompt (always loaded) | Core agent personality & rules |
| `Company Information.md` | prompt (always loaded) | Business details, contact, hours |
| `Excluded Products & Restrictions.md` | prompt (always loaded) | Products not to recommend/sell |
| `Product Knowledge & Painting Guides.md` | auto (RAG) | How-to guides, product specs |
| `Paint Sprayers Trouble-Shoot.md` | auto (RAG) | Troubleshooting guide |
| `Product Recommendation Rules.md` | auto (RAG) | Cross-sell / upsell logic |
| `Conversation & Estimation Logic paint calculation.md` | auto (RAG) | Paint quantity calculations |

---

## Key files

| Path | Purpose |
|------|---------|
| `api/shopify/inventory.js` | Real-time stock check (respects `inventoryPolicy: CONTINUE`) |
| `api/shopify/products.js` | Product search for agent |
| `api/shopify/orders.js` | Order lookup |
| `api/dashboard/knowledge-base.js` | CRUD proxy for ElevenLabs KB |
| `api/dashboard/conversations.js` | Conversation history proxy |
| `lib/dashboard-auth.js` | HMAC JWT auth for dashboard APIs |
| `src/pages/KnowledgeBasePage.jsx` | KB editor UI (Polaris) |
| `src/App.jsx` | App shell, routing, navigation |

---

## Inventory availability logic

`inventoryPolicy: CONTINUE` means "Sell when out of stock" is ON — the product is **orderable even at qty ≤ 0**.
Never use `inventoryQuantity > 0` alone as the availability check. Always use the `available` field returned by `inventory.js` / `products.js`.

---

## Auth

Dashboard API calls require a Shopify App Bridge session token (JWT) in the `Authorization: Bearer` header.
Use `dashboardFetch()` from `src/utils/fetch.js` — it attaches the token automatically.
