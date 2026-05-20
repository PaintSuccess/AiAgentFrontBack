# Knowledge Base Management Guide — Paint Access AI Chatbot

## Accessing the Knowledge Base Editor

1. Go to **Shopify Admin** → **Apps** → **Paint Access AI**
2. In the left sidebar, click **Knowledge Base**
3. You'll see all current knowledge documents listed

---

## Understanding Document Modes

| Mode | Description | Best For |
|------|-------------|----------|
| **Always loaded** | Content is included in every conversation automatically | Critical rules, company info, policies — keep under 5,000 characters |
| **RAG (auto)** | Content is retrieved only when relevant to a customer question | Large product catalogs, painting guides, detailed FAQs |

**Tip:** Use "Always loaded" sparingly. Too much always-loaded content slows responses and increases costs. Put detailed product info in "RAG (auto)" mode.

---

## Adding a New Document

1. Click **Add Document** (top right)
2. Fill in:
   - **Document Name** — A descriptive title (e.g. "Shipping Policy", "Airless Sprayer Guide")
   - **Usage Mode** — Choose "Always loaded" or "RAG (auto)"
   - **Content** — The knowledge content in plain text
3. Click **Create Document**

---

## Editing a Document

1. Click on any document row to open it
2. Modify the name, mode, or content
3. Click **Save Changes**

**Note:** Editing a document rebuilds it internally — this is normal and takes a few seconds.

---

## Deleting a Document

1. Click the **Delete** button on the document row
2. Confirm the deletion

**Warning:** This is permanent. The AI will no longer have access to this knowledge.

---

## Content Writing Tips

### Do's
- Use clear headings and bullet points
- Write in the same language your customers use
- Include specific product names, SKUs, and brands
- Add common customer questions and their answers
- Update regularly when products/policies change

### Don'ts
- Don't paste huge HTML or code — use plain text
- Don't include sensitive internal info (margins, supplier costs)
- Don't duplicate info across multiple documents
- Don't exceed 100,000 characters per document

---

## Recommended Documents to Create

| Document | Mode | What to Include |
|----------|------|----------------|
| Company Info | Always loaded | Business hours, location, contact details, returns policy |
| Bot Behavior Rules | Always loaded | Tone, escalation rules, things the AI should/shouldn't say |
| Product Restrictions | Always loaded | Products not for sale online, age-restricted items |
| Product Catalog | RAG (auto) | Full product list with descriptions, uses, and pricing ranges |
| Painting Guides | RAG (auto) | How-to guides, surface prep, paint selection tips |
| FAQ | RAG (auto) | Common customer questions and answers |
| Shipping & Delivery | RAG (auto) | Shipping zones, costs, delivery times, tracking info |
| Trade Account Info | RAG (auto) | How to apply, discounts, bulk ordering process |

---

## Current Documents

The AI chatbot currently has these knowledge documents:

1. **Bot Behavior Rules** (Always loaded) — Tone, response style, escalation rules
2. **Company Information** (Always loaded) — Business details, contact info
3. **Excluded Products & Restrictions** (Always loaded) — Products not sold online
4. **Product Knowledge & Painting Guides** (RAG) — Product info and painting advice

---

## Need Help?

For changes to the AI chatbot behavior, personality, or integrations, contact your developer.
For adding/editing knowledge content, use the Knowledge Base editor in the Shopify app.
