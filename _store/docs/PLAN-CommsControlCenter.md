# Paint Access — Communications Control Center + Marketing Automation Plan

_Status: proposal / 2026-07-10. Supersedes the "Phase 5" stub in PLAN-FullSystem.md and the read-only design in DASHBOARD_PLAN.md._

## 1. Problem statement (from client)

Two linked capabilities on top of the existing AI support stack:

1. **Unified communications control center** — one place that tracks every conversation across
   ElevenLabs (widget chat + voice) and Twilio (SMS, WhatsApp, calls), threaded per customer, with
   filters. A human can **take over any dialog** (AI steps aside), send free-text SMS/WhatsApp/email,
   or **place a recorded+transcribed outbound call** from the Twilio number. Same actions must be
   available to admins through the **ChatGPT Operations agent** ("send an SMS to client X saying Y").
   UX target: ChatGPT / Telegram / WhatsApp-Desktop style — one chat per customer, switch channel,
   see what was sent, delivery status, replies, full history, nothing lost.

2. **Marketing automation + analytics** — AI-triggered campaigns ("send this segment a WhatsApp/email
   blast") with full funnel analytics (sent → delivered → opened → clicked → returned to site →
   lead/order) and **automatic retargeting audiences** (clicked-not-bought, visited-not-ordered).
   Decide: Mailchimp vs Shopify Email vs alternative.

## 2. Current state (what exists today)

- **Read-only hub, no datastore.** `DashboardPage.jsx` fans out live to ElevenLabs + Twilio + Shopify
  draft-orders-as-emails and merges client-side. Only persistence anywhere is Upstash Redis (rate limits).
- **Inbound = synchronous AI auto-reply via TwiML** (`sms-inbound.js`, `whatsapp/inbound.js`). No
  "thread is human-controlled" state exists, so **human takeover is architecturally impossible today**.
- **Outbound is AI-only.** `sms-send.js` is a website-form handler that auto-generates the reply. No
  human free-text send path. `callback.js` (outbound recorded AI call) is disabled and not store-backed.
- **Admin MCP (`api/mcp/shopify.js`) has no messaging tools** — only Shopify order ops, Gmail, Drive.
- **No marketing layer** — no campaigns, segments, attribution, or audiences.

**Root cause:** no persistent conversation/message model as a source of truth. Everything is
reconstructed live from vendor APIs. This one gap blocks takeover, human send, outbound voice,
admin-side comms, and all analytics.

## 3. Target architecture

```
             ┌───────────────────────── Source of truth (NEW) ─────────────────────────┐
             │  Supabase Postgres: contacts · threads · messages · voice_calls ·        │
             │  campaigns · segments · events        (+ realtime + full-text search)    │
             └───────▲───────────────▲───────────────▲───────────────▲─────────────────┘
                     │ writes         │ writes         │ reads          │ reads/writes
   Inbound webhooks ─┘                │                │                │
   (sms/wa/voice) ─── Send service ───┘   Agent Inbox UI            MCP comms + marketing tools
                      lib/comms/*         (src/pages/InboxPage)     (api/mcp/shopify.js  → ChatGPT)
                      sms·wa·email·call         │                          │
                            │                    └─── humans ───┐          └─── admins via ChatGPT
             Twilio · ElevenLabs · Omnisend (email/SMS mktg) ──┘
             (Twilio also carries WhatsApp marketing — Omnisend has no WhatsApp channel)
```

**Datastore: Supabase (Postgres).** Relational threading, full-text search, row-level security,
**realtime subscriptions** (live inbox without heavy polling — the exact thing DASHBOARD_PLAN flagged as
"hard"), generous free tier. Keep Upstash for rate limiting. (Vercel KV/Upstash is key-value — wrong
shape for threads + analytics.)

### Core schema (conceptual)

- `contacts` — identity resolution across channels: `phone`, `email`, `whatsapp_id`,
  `shopify_customer_id`, `name`. One person, many channel handles.
- `threads` — one per contact (optionally per topic): `control_mode` ∈ {ai, human, paused},
  `assigned_agent`, `status`, `last_message_at`, `unread`.
- `messages` — `thread_id`, `channel` ∈ {widget, voice, sms, whatsapp, email}, `direction` ∈ {in,out},
  `author` ∈ {ai, human, customer}, `body`, `media`, `external_id` (Twilio SID / ElevenLabs conv id),
  `status` ∈ {queued, sent, delivered, read, failed}, timestamps, `cost`.
- `voice_calls` — `twilio_call_sid`, `elevenlabs_conversation_id`, `recording_url`, `transcript`.
- Marketing: `campaigns`, `campaign_recipients`, `segments`, `events`
  (sent/delivered/opened/clicked/site_visit/lead/order for attribution).

### Make the store the source of truth (ingestion)

- Every inbound webhook writes to `messages`/`voice_calls` first.
- Add Twilio **status callbacks** (`StatusCallback`) → update delivery status (sent/delivered/read/failed).
  This is what powers the WhatsApp-style delivery ticks.
- ElevenLabs **post-call webhook** (`elevenlabs-post-call.js`) → store transcript + recording.
- One-time **backfill** job pulls historical Twilio + ElevenLabs to seed the DB.

### The AI-control gate (heart of requirement 1)

On inbound message, branch on `thread.control_mode`:
- `ai` → generate + send AI reply **asynchronously via the send service** (switch SMS off synchronous
  TwiML auto-reply; return empty TwiML/200 and send via REST so we control timing + logging).
- `human` / `paused` → store message, mark thread unread, notify agent (Supabase realtime + optional
  push). **Do not auto-reply.**

Agent actions: **Take over** (`control_mode=human`), send free-text, **Hand back to AI**
(`control_mode=ai`). This is the switch that makes takeover possible.

### Shared send service (`lib/comms/`)

Channel adapters used by UI **and** MCP **and** the AI, so there's one code path:
`sendSms`, `sendWhatsApp` (session-window vs approved-template aware), `sendEmail`, `startOutboundCall`.
Each writes a `messages` row + sets `external_id`/`status`.

New dashboard APIs:
- `POST /api/comms/send` — human agent free-text send (any channel)
- `POST /api/comms/takeover` · `POST /api/comms/handback`
- `POST /api/comms/call` — outbound Twilio call with `record=true`, bridged to the ElevenLabs agent or a
  human; `recordingStatusCallback` + transcription → store in `voice_calls` + a `messages` row.
  Generalizes the disabled `callback.js` into a first-class, store-backed feature (keep consent/DNC gate).

### Agent Inbox UI (`src/pages/InboxPage.jsx`)

WhatsApp-Desktop layout: left = thread list (filter by channel, status, assigned, unread, customer);
right = unified interleaved conversation across all channels, channel switcher for composing, delivery
ticks, **Take over / Hand to AI** toggle, **Call customer** button. Realtime via Supabase subscription.
Shows Shopify customer context + recent orders (reuse `lib/shopify-customer-context.js`).

### Admin (ChatGPT) side — extend `api/mcp/shopify.js`

New MCP tools calling the **same send service** and reusing the existing approval-gate pattern
(`ops-approved` tag / explicit Daniel approval) for anything customer-facing:
- `comms_search_threads`, `comms_get_thread` (read)
- `comms_send_message`, `comms_start_call`, `comms_take_over`, `comms_hand_back`
- Marketing: `marketing_create_segment`, `marketing_send_campaign`, `marketing_get_campaign_analytics`,
  `marketing_build_retargeting_audience` — these wrap the **Omnisend API** for email/SMS campaigns +
  analytics; a WhatsApp broadcast variant routes through the Twilio send service (Omnisend has no
  WhatsApp channel) and is tracked in the Supabase `campaigns`/`events` tables.

This is the "I want to send an SMS to client X saying Y" flow — natural language → MCP tool → send
service → logged in the same thread the human sees.

## 4. Marketing & analytics — platform decision

**Client decision (2026-07-10): Omnisend** — not Klaviyo, not Shopify Email/Mailchimp. Plan is built
around Omnisend as the email/SMS marketing + analytics engine. Comparison kept for record:

| Option | Fit | Verdict |
|---|---|---|
| **Shopify Email** | 10k emails/mo free then $1/1k; native segments; basic open/click. Weak automation, **no SMS/WhatsApp**, thin analytics, poor API for AI-driven campaigns. | Not enough. |
| **Mailchimp** | Full ESP + decent API, but second-class Shopify integration, data silo, weaker ecommerce attribution. | Not the best fit. |
| **Klaviyo** | Deepest Shopify sync + richest API + strong attribution. | Strong, but **rejected by client** on cost. |
| **Omnisend** *(chosen)* | Native Shopify integration on all plans; REST **API** for campaigns, segments, contacts, custom events, and reporting — enough for AI-agent-driven sends + analytics. Email + SMS + web push, prebuilt ecommerce automations (abandoned cart, order/shipping). Notably cheaper than Klaviyo at every tier. **No WhatsApp channel.** | **Chosen engine.** |
| **Build in-house** on Supabase spine + Twilio + email ESP (Resend/SendGrid) + pixel/CAPI | Full control, no per-contact fee. | Fallback only. |

**How Omnisend fits the architecture:**

- **Email marketing + email/SMS campaign analytics** (sent → delivered → opened → clicked, + revenue
  attribution via native Shopify sync) live in **Omnisend**, driven through its REST API.
- **WhatsApp marketing is NOT an Omnisend feature** — Omnisend has no WhatsApp channel. WhatsApp
  broadcasts stay on **our Twilio path** (approved templates via Content API + opt-in), reusing the same
  `lib/comms/` send service as 1:1 messaging, and tracked in the Supabase `campaigns`/`events` tables.
  This is actually consistent: we're already building the Twilio WhatsApp path for the comms center.
- **SMS marketing — pick one lane (avoid split-brain):** either send bulk SMS through **Omnisend**
  (bundled campaign analytics, but on the Pro plan) *or* through **our Twilio path** (unified with
  conversational SMS in one thread history). Recommend: keep **conversational/1:1 SMS on Twilio** always;
  decide bulk-SMS marketing lane once we know if the client is on Omnisend Pro.
- **AI orchestration:** the ChatGPT agent's `marketing_*` MCP tools wrap the **Omnisend API** (create/
  send campaign, list/create segments, pull reporting) for email/SMS, plus a Twilio-backed WhatsApp
  broadcast tool. It becomes the natural-language front-end over Omnisend + Twilio + Shopify.
- **Retargeting audiences** ("clicked-not-bought", "visited-not-ordered"): build the segment logic from
  Omnisend engagement data + our Supabase `events`, then push to Meta/Google Custom Audiences (Omnisend
  ads-audience sync where available, or our own Meta CAPI feed). Verify Omnisend's current ad-audience
  sync depth during Phase 5 spike — this is thinner than Klaviyo's and is the main capability to confirm.

### Omnisend cost (2026)

Contact-based billing (**subscribers + non-subscribers** = billable contacts), so list size drives cost —
same reason as before to **get an actual billable-contact count before quoting** (`customers_export.zip`
minus the bounce/unsubscribe lists).

| Billable contacts | Free | Standard (email + automation, **no SMS**) | Pro (unlimited email/push, SMS add-on @ ~$0.007/SMS) |
|---|---|---|---|
| ≤250 | $0 (500 emails, 60 trial SMS) | — | — |
| 500 | — | ~$16/mo | ~$59/mo+ |
| 1,000 | — | ~$25/mo | Pro tier |
| 5,000 | — | ~$65/mo | Pro tier |
| 10,000 | — | ~$132/mo | Pro tier |

Notes: from **May 4 2026, SMS is Pro-plan only** (from $59/mo). **UPDATE 2026-07-11: client rejected
Omnisend too — still too expensive at scale.** Any per-contact marketing suite (Klaviyo/Omnisend/
Mailchimp) blows up at tens of thousands of contacts. See **§8** for the cost-optimized direction:
build analytics on the Supabase spine and send via volume-billed/self-hosted tools. Marketing engine is
now being re-selected among Listmonk+SES vs Brevo (Mailchimp ruled out).

## 7. Decisions captured

- **Datastore: Supabase (Postgres)** — confirmed (2026-07-10).
- **Marketing engine: OPEN** (2026-07-11). Klaviyo and Omnisend both rejected on cost; Mailchimp ruled
  out (per-contact billing incl. unsubscribed/duplicates, no WhatsApp, weak AU SMS). Choosing between
  **Brevo** (volume-billed SaaS, low ops — recommended default) and **Listmonk + Amazon SES**
  (self-hosted, absolute cheapest). SMS/WhatsApp sending stays on **Twilio** regardless; analytics live
  on the Supabase spine so the marketing tool is swappable.
- **Human inbox: OPEN** (2026-07-11). Choosing between **Chatwoot** (open-source helpdesk, self-host) and
  a **lean inbox built into the Shopify app**. Recommended: ChatGPT-only first, then lean Shopify inbox;
  adopt Chatwoot only if a human team handles high daily volume. See §8.
- **Build status: planning only** — nothing implemented yet.

## 5. Phased roadmap

- **Phase 0 — Decisions & foundation.** Supabase + Omnisend confirmed. Provision, define schema, env;
  Phase-5 spike to confirm Omnisend ad-audience sync depth.
- **Phase 1 — Persistence spine + ingestion + backfill.** Schema; webhooks write to DB; Twilio status
  callbacks; ElevenLabs post-call storage; backfill. Hub now reads threaded data from DB (faster, unified).
- **Phase 2 — Two-way inbox + human takeover.** Control gate, shared send service, `POST /api/comms/*`,
  `InboxPage.jsx` with realtime. (Biggest piece; delivers requirement 1's core.)
- **Phase 3 — Outbound recorded voice.** Generalize `callback.js` → `/api/comms/call` with recording +
  transcription stored in `voice_calls`; keep consent/DNC gate.
- **Phase 4 — Admin ChatGPT comms tools.** MCP `comms_*` tools reusing send service + approval gate.
- **Phase 5 — Marketing.** Omnisend integration (email/SMS campaigns + analytics) + Twilio WhatsApp
  broadcast + MCP `marketing_*` tools + analytics dashboard tab + auto-retargeting audiences.
- **Phase 6 — Unify & polish.** Full attribution loop, auto next-action, failed-message alerts, exports.

## 6. Risks / constraints

- **SMS behavior change:** synchronous TwiML → async REST send (needed for takeover + logging).
- **WhatsApp:** 24-hour session window; outside it requires approved templates (Twilio Content API);
  marketing needs opt-in + Marketing Messages API.
- **Voice recording:** consent + Do Not Call compliance (existing `callback.js` note).
- **Twilio is not an inbox** — read/delivery receipts require wiring status callbacks.
- **PII / data residency (AU)** now that we persist customer messages in Supabase.
- **Cost:** avoid per-contact marketing SaaS (see §8); Supabase + volume-billed/self-hosted sending.
- **Don't regress** the working synchronous widget/AI auto-reply path.
```

## 8. Cost-optimized architecture (client clarification, 2026-07-11)

Client re-scoped: the priority is a **single inbox where ChatGPT sees full cross-channel history, knows
what was sent + what the customer replied, with statuses, stored in our own DB, and can read history +
send new messages without opening third-party UIs** — and it must be cheap at **tens of thousands of
contacts**. This validates the Supabase-spine design; the only real change is dropping per-contact
marketing SaaS. Direct answers to the client's questions:

- **Is Twilio API + webhooks enough, or need a backend?** Twilio is enough for *transport* (send/receive
  + delivery/read receipts via status-callback webhooks) but is **not** a unified store and gives ChatGPT
  no queryable history. So yes — a thin backend (existing Vercel) + a DB are required. To minimize
  threading code, optionally use the **Twilio Conversations API** (natively threads SMS+WhatsApp+chat per
  participant with receipts + `onDeliveryUpdated` webhooks); still mirror to our DB for ChatGPT/analytics.
- **How to store everything in one base:** Supabase `contacts → threads → messages` (+ `voice_calls`,
  `events`); every inbound webhook, outbound send, and status callback writes there. Single source of
  truth; linked to Shopify via `shopify_customer_id`.
- **How ChatGPT reads + sends without third-party UIs:** extend the existing MCP (`api/mcp/shopify.js`)
  with `comms_get_thread` / `comms_search_threads` (read Supabase) + `comms_send_message` (send via
  Twilio, then log). ChatGPT calls these directly.
- **Ready-made building blocks (don't rebuild Zendesk/Klaviyo):** **Chatwoot** (MIT, self-hosted
  omnichannel inbox incl. Twilio SMS/WhatsApp + email, REST API + webhooks) for the human console;
  **Twilio Conversations API** for the threading backbone; **Listmonk** (self-hosted) or **Brevo**
  (volume-billed SaaS) for marketing; **Amazon SES** for cheap email.

### Cost-optimized stack

| Layer | Choice | Cost |
|---|---|---|
| Transport (SMS/WhatsApp/voice) | Twilio (existing) | usage-based |
| Backend / ingest | Vercel (existing) | — |
| Source of truth | Supabase (Postgres) | $0 free → ~$25/mo |
| ChatGPT access | MCP `comms_*` tools | $0 |
| Human inbox *(optional)* | Chatwoot (self-host) **or** lean Shopify InboxPage | ~$10–20/mo VPS **or** ~$0 |
| Marketing *(optional)* | Brevo (volume-billed) **or** Listmonk + Amazon SES | ~$8–65/mo, **no per-contact fee** |

New recurring cost ≈ **$0–65/mo**, flat with list size — vs Klaviyo/Omnisend/Mailchimp at hundreds/mo.
Scale limit for "tens of thousands" is **sending throughput + messaging policy** (Twilio rate limits,
WhatsApp templates/opt-in, SES warm-up), not Postgres — the DB handles that volume trivially.

### Open fork A — human inbox

| | Chatwoot (adopt OSS) | Build lean in Shopify |
|---|---|---|
| Time to rich human UI | Fast (prebuilt) | Slower (build it) |
| Ops burden | Run a server (Docker/upgrades/backups) | None (existing infra) |
| Native to Shopify | No — separate app (iframe-able) | Yes |
| Source of truth | Two (Chatwoot + Supabase, must sync via webhooks) | One (Supabase) |
| Extra cost | ~$10–20/mo VPS | ~$0 |
| Best when | A team lives in the inbox at high volume | ChatGPT primary, humans occasional |

Recommendation: **ChatGPT-only first** (spine + MCP), then **lean Shopify inbox**; Chatwoot only if a
human support team handles high daily volume.

### Open fork B — marketing engine (per-contact suites rejected)

| | Listmonk + Amazon SES | Brevo | Mailchimp |
|---|---|---|---|
| Billing basis | Flat (self-host) | **Send volume** | **Per contact** (incl. unsubscribed/dupes) |
| ~Cost @ 10k contacts | ~$8–20/mo | ~$20–65/mo | $100–350/mo |
| Ops burden | High (self-host + SES warm-up) | Low | Low |
| WhatsApp / AU SMS | via Twilio | limited + Twilio | none / weak |
| API for ChatGPT | yes | yes | yes |

Recommendation: **Brevo** default (volume-billing is the big win for a large list); **Listmonk+SES** if
they want the absolute floor and will self-host. **Mailchimp ruled out** — most expensive at scale,
charges for dead contacts, no native WhatsApp, weak Australian SMS. SMS/WhatsApp blasts stay on Twilio;
analytics on Supabase — so the marketing tool is swappable later without re-architecting.
