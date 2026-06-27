# Lead Capture & Shopify Customer Sync

## Current Status

- `app/api/shopify/customer.js` exists and creates new Shopify customers from approved guest lead capture.
- The live ElevenLabs agent has a `capture_lead` webhook tool attached.
- The live prompt now requires the agent to call `capture_lead` before saying a guest was saved or added.
- For privacy, the public AI flow does **not** mutate an existing Shopify customer record based only on a spoken/typed email address.
- Logged-in customer note updates are **not** performed by `capture_lead`; that requires a separately verified customer/session path before it should write to private Shopify customer records.

## Problem

- Guests who chat with the AI widget are **never added to Shopify** — zero CRM record.
- The SMS/callback form creates a **draft order** as a workaround, not an actual Shopify customer.
- Result: repeat visitors aren't recognised, no email marketing, no trade discount flow.

---

## Goals

1. **Agent captures guest leads**: when `customer_id` is empty (not logged in), Jessica asks for permission + name + email (+ phone if useful) after a helpful exchange and calls `capture_lead` tool → new Shopify customer created with tag `ai-lead`.
2. **Callback → Shopify customer**: when SMS callback is requested (widget form OR agent tool), the contact is upserted into Shopify customers automatically — separate from the draft order log.

---

## What Already Exists

| File | What it does |
|---|---|
| `app/api/callback.js` | Collects name/phone/email, creates a draft order, triggers outbound AI call |
| `app/lib/shopify.js` | `shopifyFetch()` (REST) + `shopifyGraphQL()` helpers |
| `app/api/shopify/products.js` | Example of a webhook tool endpoint with auth |
| `setup/create-tools.js` | Registers all ElevenLabs agent tools |
| `setup/update-agent.js` | System prompt + first message |
| Widget `dynamic-variables` | Already sends `customer_id`, `customer_email`, `customer_name` to agent |

---

## Architecture

```
Guest user talks to widget
        │
        ▼
Agent sees {{customer_id}} == "" (guest)
        │
        │  after 1-2 exchanges (natural moment)
        ▼
Agent: "By the way, can I grab your name and email so I can follow up?"
        │
        ▼
Agent calls capture_lead { name, email, phone? }
        │
        ▼
POST /api/shopify/customer  ← new Vercel endpoint
        │
        ├─ Search Shopify customers by email
        ├─ If found: skip mutation (existing customer is unverified in public AI flow)
        └─ If not found: create customer (tags: AI Agent, ai-lead, ai-widget)
        │
        ▼
Agent: "Got it! I've saved your details." only when action is "created"
```

```
User fills callback widget form  OR  Agent calls request_callback tool
        │
        ▼
POST /api/callback  (existing)
        │
        ├─ 1. Create draft order (existing — kept as audit log)
        ├─ 2. Upsert Shopify customer  ← NEW step added here
        └─ 3. Trigger outbound call (existing)
```

---

## Build Steps

### Step 1 — New API endpoint: `app/api/shopify/customer.js`

**Route:** `POST /api/shopify/customer`  
**Auth:** Bearer `API_SECRET_TOKEN` (same as other endpoints)

**Request body:**
```json
{
  "name": "John Smith",
  "email": "john@example.com",
  "phone": "+61412345678",     // optional
  "tags": ["ai-lead"],        // optional, default: ["ai-lead","ai-widget"]
  "note": "Via AI widget"     // optional
}
```

**Response:**
```json
{
  "customer_id": 123456789,
  "action": "created" | "skipped",
  "email": "john@example.com"
}
```

**Logic:**
1. Validate: `name` and `email` required; reject clearly invalid email patterns.
2. Search Shopify: `GET /admin/api/2024-10/customers/search.json?query=email:<email>`
3. **If found**: return `action: "skipped", reason: "existing_customer_unverified"` and do not mutate the customer record.
4. **If not found**: `POST /customers.json` — create with `first_name`, `last_name` (parsed from `name`), `email`, `phone`, `tags`, `note`.
5. Never overwrite existing `accepts_marketing` — leave as-is (compliance).

**Security:**  
- `verifyAuth(req, res)` from `lib/shopify.js`  
- Email sanitised and validated (regex + length cap)  
- Phone stripped to digits/+ only  
- All strings capped at safe lengths

---

### Step 2 — New ElevenLabs webhook tool: `capture_lead`

Add to `setup/create-tools.js` (in `toolDefs` array):

```js
{
  tool_config: {
    type: "webhook",
    name: "capture_lead",
    description:
      "Save a potential customer's contact details to the Paint Access CRM (Shopify). " +
      "Use ONCE per conversation when a guest (not logged in) shares their name and email. " +
      "Do NOT call this for logged-in customers (customer_id is already set). " +
      "Do NOT call more than once per session.",
    force_pre_tool_speech: false,
    api_schema: {
      url: `${BACKEND_URL}/api/shopify/customer`,
      method: "POST",
      request_headers: { Authorization: `Bearer ${API_SECRET}` },
      request_body_schema: {
        type: "object",
        required: ["name", "email"],
        properties: {
          name:  { type: "string", description: "Customer's full name." },
          email: { type: "string", description: "Customer's email address." },
          phone: { type: "string", description: "Customer's phone number (optional)." },
          note:  { type: "string", description: "Short context note, e.g. 'Asked about sprayers'." },
        },
      },
    },
  },
}
```

Run `node setup/create-tools.js` after adding.

---

### Step 3 — Update `app/api/callback.js`

After the draft order is created (existing step 1), add step 1b:

```js
// ---- 1b. Upsert Shopify customer ----------------------------------------
try {
  const BACKEND = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://ai-agent-front-back.vercel.app';
  await fetch(`${BACKEND}/api/shopify/customer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.API_SECRET_TOKEN}`,
    },
    body: JSON.stringify({
      name: cleanName,
      email: cleanEmail || undefined,
      phone: cleanPhone,
      note: 'SMS callback request via AI widget',
      tags: ['ai-lead', 'callback-request'],
    }),
  });
} catch (err) {
  console.error('[Callback] Customer upsert error:', err.message);
}
```

Alternatively, share the Shopify upsert logic directly (same process, avoids self-HTTP call) — better for cold-start latency.

---

### Step 4 — Update system prompt in `setup/update-agent.js`

Add a new section **`## capture_lead`** inside the `# Tool Usage` section:

```
## capture_lead
Use this tool ONCE per conversation when ALL of these are true:
- {{customer_id}} is empty (guest, not a logged-in Shopify customer)
- The customer has shared their name AND email (don't ask for both at once — collect naturally)
- You haven't already called capture_lead this session

When to ask:
- After the first helpful exchange (not as an opener)
- Natural phrasing: "Can I grab your email so I can follow up or send you those product details?"
- If they decline: "No worries, happy to help anyway!" — never push again

When NOT to ask:
- If {{customer_id}} is set (already in Shopify)
- If they're just browsing and haven't engaged with a real question
- In the same breath as asking for their order number (keep asks separate)

After capture_lead returns action "created": say "Perfect, I've saved your details." and continue naturally.
If it returns action "skipped" for an existing unverified customer, do not claim the customer record was changed.
```

Run `node setup/update-agent.js` after editing.

---

## File Checklist

| File | Change |
|---|---|
| `app/api/shopify/customer.js` | **CREATE** — upsert endpoint |
| `app/api/callback.js` | **EDIT** — add customer upsert after draft order |
| `setup/create-tools.js` | **EDIT** — add `capture_lead` tool definition |
| `setup/update-agent.js` | **EDIT** — add `## capture_lead` section to system prompt |

---

## Deploy Sequence

```
1. Deploy Vercel (app/) — new endpoint must be live before tool is registered
   cd app && vercel --prod

2. Register new tool on ElevenLabs agent
   cd setup && node create-tools.js

3. Update agent system prompt
   cd setup && node update-agent.js

4. Smoke test
   - Open https://www.paintaccess.com.au/?ai-widget=1 as a guest
   - Ask about a product → agent helps → after 1-2 exchanges, agent asks permission/details or responds correctly when asked to be added
   - Confirm Shopify customer created with tag 'ai-lead'
   - Fill callback form → confirm Shopify customer created/updated through that callback path
```

---

## Shopify Customer Tags Reference

| Tag | Meaning |
|---|---|
| `ai-lead` | Captured via AI widget (guest) |
| `ai-widget` | Any AI widget touchpoint |
| `callback-request` | Requested SMS/phone callback |

---

## Open Questions

1. **Marketing consent**: Should the customer upsert set `accepts_marketing: true`? Legally safer to leave it `false` by default and let the customer opt-in later via email.
2. **Phone-only callbacks**: Callback form collects phone without email — still create Shopify customer? Shopify requires email OR phone (phone-only is supported since 2023-01 API).
3. **Duplicate handling**: If email is missing but phone matches an existing customer, merge or skip? Recommend: skip upsert, just keep the draft order log.
4. **Metafields**: Worth writing a `ai_widget.last_session` metafield on the customer for analytics?
