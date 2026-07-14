# Plan — WhatsApp Template Sending + Consent Layer

_2026-07-14. For review before build. Two features: (1) send approved WhatsApp
templates from the hub to reconnect outside the 24h window / reach new numbers;
(2) a unified consent layer so marketing outreach is opt-in and compliant._

---

## Feature 1 — WhatsApp template sending

### Goal
Let an agent (and later the AI/MCP) send a **Meta-approved WhatsApp template** from
the conversation composer, so they can message a customer whose 24-hour window has
closed (e.g. Anton) or a brand-new number. Plus a proactive banner so agents don't
hit the 63016 failure.

### What already exists
- `lib/whatsapp.js sendWhatsAppMessage({ type: "template", template: { contentSid, variables } })`
  already does Twilio template sends. Env has 3 approved templates:
  `WHATSAPP_TEMPLATE_SUPPORT_FOLLOWUP`, `_QUOTE_READY`, `_ORDER_ENQUIRY_UPDATE` (ContentSids).
- What's missing: the template **body text + variable definitions** (needed to render a
  preview and collect variables), a send path through `lib/comms/send.js`, and UI.

### Design
1. **Template registry** — `lib/comms/wa-templates.js`: static list of the approved
   templates, each `{ key, label, category, contentSidEnv, body, variables:[{name,example}] }`.
   Body/variables mirror what Meta approved (needed for preview + inputs). ContentSid read
   from env at send time (never exposed to the browser).
2. **Backend send** — extend `lib/comms/send.js sendMessage()` with an optional
   `template: { key, variables }`. When channel=whatsapp + template: resolve contentSid from
   the registry/env, call `sendWhatsAppMessage(type:"template")`, and `recordOutbound` with
   `body` = the template body with variables filled in (so the thread shows readable text),
   `metadata.template = key`, status from Twilio. Auto-takeover already applies (author=human).
3. **Endpoints**
   - `GET /api/comms/wa-templates` — returns the registry **without** ContentSids
     (`key, label, category, body, variables`) for the picker.
   - `POST /api/comms/send` — extend to accept `{ channel:"whatsapp", template:{ key, variables } }`.
4. **UI (composer)**
   - "Template" button next to Quick replies (only for WhatsApp threads). Opens a picker:
     choose template → shows body with variable inputs (prefill `{{1}}` = contact name, etc.)
     → live preview → Send.
   - **24h-window banner**: compute the last **inbound** WhatsApp message time from the loaded
     thread. If > 24h old (or none), show: "⏳ 24-hour WhatsApp window is closed — free-form
     won't deliver. Send an approved template to reconnect." and surface the Template button.
5. **MCP (optional, small)** — a `comms_send_whatsapp_template` tool so the ChatGPT agent can
   also send templates (approval_reference gated). Can be a fast-follow.

### Files
- new `lib/comms/wa-templates.js`, new `api/comms/wa-templates.js`
- edit `lib/comms/send.js`, `api/comms/send.js`, `src/pages/InboxPage.jsx`, `src/pages/inbox.css`

### Input needed from you
The **exact approved body text + variable meaning** for the 3 templates
(`support_followup`, `quote_ready`, `order_enquiry_update`) — copy them from Twilio Content
Template Builder / Meta. Without the real bodies the preview/variables can't match what
Meta approved. (I can stub placeholders and you correct them.)

### Out of scope (later)
- Submitting/creating new templates from the app (done in Twilio/Meta).
- Bulk template blasts (that's the marketing module + consent gate below).

---

## Feature 2 — Consent layer

### Goal
A unified, per-channel opt-in record on each contact — the compliance backbone for all
marketing (WhatsApp marketing templates, SMS/email blasts, marketing calls). Transactional
messages (order updates, replies, Utility templates, requested callbacks) are NOT gated.

### Schema — migration `0004_consent.sql`
Add to `contacts`:
```
email_marketing     text default 'unknown'   -- subscribed | not_subscribed | unsubscribed | unknown
sms_marketing       text default 'unknown'
whatsapp_marketing  text default 'unknown'
calls_consent       text default 'unknown'
do_not_call         boolean default false     -- DNCR / explicit opt-out of calls
consent_source      text                      -- shopify | checkout | keyword | preference_page | manual
consent_updated_at  timestamptz
```

### Shopify as source of truth (email + SMS)
Shopify customers carry `email_marketing_consent` and `sms_marketing_consent` (state +
opt-in level + timestamp). So:
- **Read**: when loading a contact (extend `lib/shopify-customer-context` / the contact
  endpoint), map Shopify consent → our `email_marketing` / `sms_marketing`.
- **Write-back**: when consent is changed in the hub, PATCH the Shopify customer's
  `email_marketing_consent` / `sms_marketing_consent` (reuse `lib/comms/shopify-sync.js`).
- WhatsApp + calls have no Shopify field → stored only locally.

### Capture methods (build order)
1. **Shopify sync** (read existing consent) — build now.
2. **Keyword opt-out/in** on SMS + WhatsApp inbound: detect `STOP`/`UNSUBSCRIBE` →
   set the channel to `unsubscribed` + record; `START`/`YES` → `subscribed`. (Twilio also
   auto-blocks SMS after STOP at the carrier level; we record it so campaigns exclude them.)
   — build now (small addition to the inbound webhooks).
3. **Manual toggle** in the contact panel — build now.
4. **Public preference page** (a hosted link where a customer manages channel prefs, with a
   signed token) — **later** (bigger; part of marketing rollout).
5. **Checkout checkbox** — already handled by Shopify; picked up via #1.

### Enforcement
- `lib/comms/consent.js canSendMarketing(contact, channel)` → boolean (subscribed AND not
  do_not_call). Used by: the future marketing module (hard gate) and, now, a **warning**
  when an agent sends a **Marketing-category** WhatsApp template to a non-subscribed contact.
- Transactional/Utility sends bypass the gate.

### UI (contact panel)
- A "Consent" section: per-channel status chips (Email / SMS / WhatsApp / Calls) with a
  toggle. Email/SMS toggles write back to Shopify; WhatsApp/Calls stored locally. Show
  source + last-updated.

### Files
- new `supabase/migrations/0004_consent.sql`, new `lib/comms/consent.js`
- edit `api/comms/contact.js` (surface consent), `api/comms/contact-update.js` (set consent),
  `lib/comms/shopify-sync.js` (consent write-back), `api/twilio/sms-inbound.js` +
  `api/whatsapp/inbound.js` (keyword capture), `src/pages/InboxPage.jsx` (consent UI).

### Out of scope (later)
- **Public preference/subscription page** + signed links. **Decision (2026-07-14): build
  AFTER the bulk-marketing engine (Brevo/Listmonk) is chosen** — bundle it into that rollout
  rather than build it standalone now. When built: **host it inside the Shopify storefront
  theme** (not a standalone Vercel page), so it matches the site's design system. Design notes
  for that future build:
  - One link, reachable from order confirmations / SMS-WhatsApp footers / a site form, resolved
    via a signed token tied to the contact (no login required).
  - Toggles for Email / SMS / WhatsApp (calls stays staff-managed, tied to DNC).
  - WhatsApp opt-in must be the customer's affirmative action per Meta policy: site form
    (phone + explicit consent text) → send one allowed "confirm opt-in" template → their reply
    is the actual proof of consent (mirrors email double opt-in).
  - Feeds the same `setConsent()` already built — no new data-layer work, just a public
    token-scoped endpoint + themed page.
- DNCR register file scrubbing/import (we store a `do_not_call` flag; bulk DNCR matching is
  a marketing-module concern).
- The bulk-marketing send engine itself (Brevo/Listmonk decision, still deferred).

### Investigation note (2026-07-14) — a live Klaviyo double opt-in email fired during testing
Setting the test contact's email consent to "subscribed" via the Shopify Admin API (in
`scripts/test-consent.js`) triggered a live "Confirm Your Subscription" email via
`shared.klaviyomail.com` — i.e. **some Klaviyo connection appears to exist on the live store**,
separate from anything in this codebase (confirmed: zero Klaviyo references in app code, theme,
or our env). Root-project CSVs (`bounce_spam_*.csv`, `customers_export.zip`) suggest an ESP was
in prior use for list cleanup. Cannot verify via our Shopify access token (Shopify doesn't expose
one app's installed-apps list to another) — **user needs to check Shopify Admin → Settings →
Apps and sales channels.** Severity was low: double opt-in confirmations are per-profile
transactional triggers, not bulk sends — only the one test contact was touched.
**Caution going forward:** any Shopify consent-field write from our backend can ripple into
whatever marketing tool is actually connected to the store — treat live consent writes on real
(non-isolated-test) contacts carefully.

---

## Suggested build order
1. WhatsApp template registry + backend send + `/api/comms/*` (Feature 1 backend).
2. Composer template picker + 24h banner (Feature 1 UI).
3. Consent migration + Shopify read/write + `consent.js` (Feature 2 backend).
4. Keyword capture in inbound webhooks + contact-panel consent UI (Feature 2 capture/UI).
5. Wire the marketing-template consent warning (ties 1 + 2 together).

Each step is committed + deployed + tested (real Twilio/Shopify, reversible) as we go.

## Decisions (2026-07-14, approved to proceed)
1. **Template bodies** — drafted tailored to PaintAccess (see Appendix). Registry stubbed with
   these; must be reconciled with the *actual Meta-approved* wording per ContentSid (either
   submit the drafts to Meta for new SIDs, or paste the existing approved text into the registry).
2. **Existing-contact consent migration** (NOT "subscribe all" — that risks WhatsApp number
   suspension + AU Spam Act/DNCR fines; consent is per-channel and non-transferable):
   - **Email** → sync Shopify `email_marketing_consent` → immediate subscribed base, no delay.
   - **SMS** → sync Shopify `sms_marketing_consent` (whatever exists).
   - **WhatsApp / Calls** → start `unknown`; grow opt-in (site/checkout checkbox, keyword,
     inbound contact). Do not back-fill assumed consent.
3. **`comms_send_whatsapp_template` MCP tool** — include now (approval_reference gated).

## Appendix — drafted templates (submit to Meta / reconcile with existing SIDs)
- `support_followup` (Utility): "Hi {{1}}, it's Jessica from Paint Access 👋 Following up on your
  enquiry — did you get everything you needed? Reply here and I can help with products, stock, or
  your order, or call 02 5838 5959." — {{1}}=first name
- `quote_ready` (Utility): "Hi {{1}}, your Paint Access quote for {{2}} is ready 🎨 Total: {{3}}.
  Reply here to confirm or ask a question and we'll sort it, or call 02 5838 5959." — name/item/total
- `order_enquiry_update` (Utility): "Hi {{1}}, an update on your Paint Access order {{2}}: {{3}}.
  Reply here with any questions or call 02 5838 5959 and we'll help." — name/order#/status
- `reengage_offer` (Marketing, opt-in required): "Hi {{1}}! 🎨 It's been a while — Paint Access has
  fresh deals on sprayers and paint supplies. Browse the latest: {{2}}. Reply STOP to opt out."
