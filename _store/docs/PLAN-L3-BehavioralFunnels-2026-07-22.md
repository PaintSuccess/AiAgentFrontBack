# PLAN — L3 Behavioral Funnels (Retargeting & Win-back)

**Date:** 2026-07-22 · **Level:** L3 of the client's 4-level model (§0d of the pipeline plan) ·
**Build order:** 2nd (after L4's pieces are exercised by real traffic).

L3 = *AI watches what a customer does (visits, views a product, leaves, returns), and automatically
fires a chain of messages across WhatsApp / SMS (and email, see §5) to bring them back and drive the
purchase.* The client's exact framing: «зашёл на сайт, посмотрел товар, ушёл, вернулся… по этим
событиям автоматически запускается цепочка сообщений».

---

## 1. What is already LIVE — the substrate we do NOT rebuild

L3 is not greenfield. Everything it *reacts to* already flows:

| Piece | Status | L3 uses it for |
| --- | --- | --- |
| `web_events` (page/product/collection/cart views, search) | ✅ live | the trigger signals ("viewed product, left") |
| Link-token identity stitching (`?pa=` → `contact_id`) | ✅ live | knowing *who* to message (see §6 — the reach constraint) |
| `events` (message lifecycle + `ad_referral`) | ✅ live | conversion/return detection + funnel audit trail |
| `contacts` / `threads` / `messages` spine | ✅ live | the person, their channels, their history |
| `canSendMarketing(contact, channel)` | ✅ built (unused) | **the consent gate — finally enforced here (H5)** |
| `lib/comms/send.js` (SMS + WhatsApp, freeform + approved template) | ✅ live | the actual send |
| WhatsApp approved templates (`reengage_offer`, `quote_ready`, …) | ✅ live | outside-24h-window sends |
| Meta CAPI `reportPurchase` | ✅ built (token-gated) | fire a Purchase event when a funnel converts |

**So the ONLY genuinely new thing L3 needs is the engine that connects them:** a
trigger/orchestration layer that watches the events, decides *who* enters *which* chain, and fires the
right message on the right channel at the right time.

---

## 2. The one new component: the trigger/orchestration engine

Two moving parts, both driven by ONE scheduled sweep (no new hot-path coupling — see §3):

1. **Enrollment** — scan recent `web_events` for signals matching a funnel's entry rule, for a *known*
   contact not already in that funnel → create an enrollment.
2. **Advancement** — for enrollments whose next step is due: check exit conditions, else send the
   step's message, then schedule the next step (or complete).

### Data model

**Funnel definitions live in CODE, not a DB builder** (version-controlled, reviewable in git, no
flow-builder UI to build on day one). `lib/comms/funnels/definitions.js`:

```js
{
  key: "browse_abandon",
  name: "Browse abandonment",
  enabled: true,
  enroll: { event: "product_viewed", requiresKnownContact: true },
  exitOn: ["purchased", "unsubscribed"],          // checked before every step
  steps: [
    { after: "2h",  channels: ["whatsapp"],          content: "ai_freeform",
      prompt: "They viewed {{product}} but didn't buy. One warm, helpful nudge + a question." },
    { after: "24h", channels: ["whatsapp", "sms"],   content: "template:reengage_offer" },
  ],
}
```

**State lives in the DB** — new table `funnel_enrollments` (migration 0009):

```
id, contact_id, funnel_key,
status        active | processing | completed | converted | exited | failed
current_step  int
enrolled_at, next_action_at, last_action_at, enroll_event_id, exit_reason
-- one ACTIVE enrollment per (contact, funnel):
unique index on (contact_id, funnel_key) where status in ('active','processing')
```

Sends and conversions are logged into the existing `events` table (`funnel_sent`, `funnel_converted`),
so the Marketing page and analytics get L3 for free.

### The loop (pseudocode of the sweep endpoint)

```
POST /api/cron/funnels                     # called by the scheduler, secret-guarded
  if !ENABLE_FUNNELS: return                # ship-dark kill switch
  ── ENROLL ──
  for each funnel:
    new web_events since watermark matching funnel.enroll, contact_id NOT NULL,
      not already active in this funnel  →  insert enrollment (next_action_at = now + step0.after)
  ── ADVANCE ──
  claim due:  UPDATE ... SET status='processing'
              WHERE next_action_at <= now AND status='active' RETURNING *   # lease = no double-send
  for each claimed enrollment:
    if exit condition met (order since enrolled / unsubscribed) → mark converted|exited (+ CAPI on convert)
    else:
      channel = first of step.channels where canSendMarketing(contact,ch)
                 AND has address AND (for WA: window-open OR approved-template-available)
      if no channel / frequency-capped / quiet-hours → defer next_action_at, keep active
      else → draft content (AI or template) → send.js → log event 'funnel_sent'
      advance current_step (or mark completed) ; set next_action_at
```

---

## 3. Key architectural decisions

### D1 — Scheduler ✅ RESOLVED: Supabase pg_cron
No scheduler exists (the `sweepExpiredControl` pattern only runs when the admin UI polls — useless for
background marketing timing). Vercel Cron was the obvious candidate but its minimum interval depends on
the Vercel plan tier (Hobby ≈ daily, too coarse for a "2h later" step), and the tier isn't cleanly
knowable. **Decision: use Supabase `pg_cron` + `pg_net`** — we already run Supabase with full DDL access
via the Management API, it's tier-independent, runs at any interval, and Postgres calls our
secret-guarded `/api/cron/funnels` endpoint over HTTP. One less external dependency, fully in our
control. Step delays are approximate ("~2h"), which is correct for marketing timing.

### D2 — Email in the engine? *(the real fork — changes scope)*
**Our engine physically cannot send marketing email** — Shopify has no send API (verified 22 Jul), and
we chose no paid SaaS. So:
- **Option A (recommended): WA/SMS engine + Shopify native email automations in parallel.** The engine
  orchestrates WhatsApp + SMS; email behavioral flows (abandoned cart, browse abandonment, win-back)
  run as **Shopify's own native automations** (the E1 work). Two rails, coordinated by shared segments,
  not one engine. No new vendor, ships now.
- **Option B: add Amazon SES** (usage-billed ~$0.10/1,000 — arguably not "paid SaaS", it's
  infrastructure) so email becomes a channel *inside* our engine, giving true single-engine
  cross-channel orchestration and the "double up" the client describes. More build; unifies later.
- **Recommendation: A now, keep B as the documented upgrade.** It delivers L3's WA/SMS value
  immediately while Shopify covers email, and B can slot in without redesign (email just becomes
  another `channels: [...]` option).

### D3 — Funnel definitions: code vs DB-builder
**Code first** (above). A DB-backed visual builder is a real product but a later phase; starting there
would mean building a UI before proving the engine. Config-in-git is faster, safer, reviewable.

### D4 — Channel selection
Each step declares an ordered `channels: [...]`; the engine picks the first that is **consented +
addressable + sendable** (WA: window open or template available). The client's "AI chooses the channel"
is a later enhancement on top of this deterministic, cheap, predictable base — not the first cut.

---

## 4. Safety & compliance (this is where H5 finally gets teeth)

Every one of these is mandatory in the engine — L3 is the first thing that sends marketing unprompted,
so the guardrails are the feature, not an afterthought:

- **Kill switch** — `ENABLE_FUNNELS` env unset = engine inert. Ship dark, like `ENABLE_AI_CALLBACK`.
- **Test-only mode** — `FUNNELS_TEST_ONLY=true` fires only for `internal_test` contacts first.
- **Consent gate** — `canSendMarketing(contact, channel)` on every send, no exceptions. This is the
  enforcement H5 has been waiting for.
- **Frequency cap** — `MARKETING_MAX_PER_WEEK` per contact across ALL funnels (count `funnel_sent`
  events, last 7d). Prevents chain pile-up.
- **Quiet hours** — AU timezone; no sends 21:00–09:00 → defer, don't skip.
- **WhatsApp 24h window** — compute from the last *inbound* message; inside → freeform AI text allowed;
  outside → approved template only (existing `sendWhatsAppTemplate`). New small helper needed.
- **Idempotency** — unique active enrollment per funnel; `processing` lease on claim so two sweeps
  can't double-send.
- **Auto-suppress** — STOP/unsubscribe already flips consent (existing); the gate then blocks the
  contact automatically.

---

## 5. The email split, stated plainly

Because of D2, L3 runs on **two rails**:
- **WhatsApp + SMS** → our engine (this plan).
- **Email** → Shopify native automations (abandoned cart / welcome / win-back), configured once in
  admin, AI-drafted copy. We can't API-trigger them and don't need to — Shopify fires them itself.

They coordinate through the shared audience (Shopify segments + our contacts), not through one
orchestrator. True single-engine email (the client's "one system picks the channel including email")
requires Option B (SES) and is the documented next step, not the first build.

---

## 6. The reach constraint (and why L4-before-L3 is correct)

**L3 can only message a KNOWN contact** — one with a `contact_id`, a consented channel, and an address.
A purely anonymous `web_event` (a `client_id` we've never stitched) has nobody to text. So L3's initial
reach = people who have **messaged us** (have a phone) or **clicked a tagged link we sent** (stitched).

This is exactly why the build order is L4 → L3: **L4 brings people in and identifies them; L3
re-engages the identified ones.** Browse-abandonment for a known WhatsApp contact who tapped a tagged
product link is the sweet spot where the two levels join. Chasing anonymous browsers needs cookie
matching or Shopify Protected-Customer-Data approval — explicitly out of scope for L3.

---

## 7. Phasing

| Phase | Scope | Exit criteria |
| --- | --- | --- |
| **L3.0 — skeleton** | migration 0009; engine + sweep endpoint; ONE funnel (`browse_abandon`, single WhatsApp step); kill switch ON, `FUNNELS_TEST_ONLY`; scheduler wired | fires one message to an internal_test contact who viewed a product, end-to-end, logged |
| **L3.1 — guardrails** | consent gate + frequency cap + quiet hours + WA 24h-window/template logic | a real (non-test) contact gets a compliant send; a non-consented one gets nothing; verified |
| **L3.2 — chains + conversion** | multi-step chains, exit conditions, `funnel_converted` → fire CAPI Purchase | a 2-step chain runs, exits on purchase, and reports the sale to Meta |
| **L3.3 — channel ladder** | WA↔SMS fallback per step by consent/engagement | a step with no WA consent falls back to SMS correctly |
| **L3.4 — visibility + email rail** | Marketing-page "Funnels" section (enrollments, sent, converted); enable the 3 Shopify native email automations (E1) in parallel | operator can see funnel performance; email flows live on Shopify's side |

Ship each phase dark → test-contacts → a small real cohort → full. Never flip the whole 14K at once.

---

## 8. Cost

- **Scheduler:** Vercel Cron (included) or Supabase pg_cron (included — we already run Supabase).
- **Storage/DB:** on the existing Supabase spine — negligible.
- **AI drafting:** the existing ElevenLabs text agent, or a cheap per-message LLM call — cents.
- **Sends:** Twilio per message (WA ≈ AUD $0.05–0.11, SMS varies) — the only real variable, and it's
  pay-per-send, exactly the model the client wants. Frequency cap bounds it.
- **No subscription.** (Email rail = Shopify Messaging usage-billed, ~$1/1,000; or SES ~$0.10/1,000 if
  Option B.)

**vs a SaaS flow-builder (Klaviyo/Omnisend Pro):** those charge hundreds/month for per-contact storage
to do exactly this. We build it once and pay only per message.

---

## 9. Non-goals (explicitly out of scope for L3)

- Anonymous-browser retargeting (needs cookie matching / Shopify PCD approval — a later spike).
- A visual funnel builder UI (config-in-code first).
- Email inside our engine (Shopify native automations for now; SES is the documented Option B).
- AI free-choice of channel/timing beyond the deterministic ladder (later enhancement).
- Ads/CTWA (that's L4, separate and in flight).

---

## 10. Open decisions for the user

1. **Email fork (D2):** WA/SMS engine + Shopify native email automations in parallel *(recommended)*,
   or add SES now to unify email into the engine?
2. **First funnel (L3.0):** browse-abandonment (viewed a product, no purchase) *(recommended — highest
   frequency signal)*, or cart-abandonment, or win-back (inactive N days)?

Scheduler (D1) is resolved (Supabase pg_cron). Everything else is decided or has a clear recommendation
above. Nothing in L3 is blocked on the client except the same L4 dependencies feeding it identified
contacts.
