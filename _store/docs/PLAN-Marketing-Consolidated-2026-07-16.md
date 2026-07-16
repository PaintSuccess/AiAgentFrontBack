# Marketing + WhatsApp Funnel — Consolidated Review (2026-07-16)

**Purpose:** the marketing idea has drifted across 4+ documents and ~2 months. This doc pulls every
version onto one table, states what is actually built today, maps the client's new WhatsApp-funnel
requirement against it, and lists the decisions to settle in tomorrow's architecture session.

**Status: DISCUSSION DOC — decides nothing on its own.** It supersedes the marketing sections of the
docs below once the open decisions in §6 are made.

---

## 1. Where the plans live (every place marketing was specified)

| Date (git) | Doc | What it said about marketing | Status now |
| --- | --- | --- | --- |
| 2026-05-20 | `LEAD_CAPTURE_PLAN.html` | Lead capture → Shopify Customer (tag `AI Agent`) → "feed downstream marketing — **Omnisend** / Shopify Flow". Optional `POST /api/omnisend/upsert-contact`. Open Q: Shopify→Omnisend native sync vs direct push. Flagged consent (Spam Act) + UTM capture as missing. | **Engine dead** (Omnisend rejected on cost). Lead-capture + consent parts are now BUILT. |
| 2026-05-20 | `PLAN-FullSystem.md` §Phase 5 | "Centralized Logging & Continuity" only — no marketing at all. | **Superseded** by PLAN-CommsControlCenter (its own note says so). |
| 2026-05-22 | `DASHBOARD_PLAN.md` | Read-only dashboard. | **Superseded.** |
| 2026-05-18 → 06-27 | `WHATSAPP_META_PLAN.html` | **The original WhatsApp funnel.** AI sales funnel over WhatsApp (greeting → qualify → recommend → cart → checkout), lead capture, Shopify push, source analytics, downstream Omnisend + Meta retargeting, 20–50 short product videos. Provider fork: Twilio (Path A) vs Meta Cloud API (Path B, "full access to Click-to-WhatsApp ads"). | **Mostly still valid as intent — stale on facts.** Its provider fork is now resolved (see §5). Its Omnisend dependency is dead. |
| 2026-07-10 → 07-13 | `PLAN-CommsControlCenter.md` §4, §8 | Omnisend **chosen** → then **rejected on cost** (per-contact billing). Engine reopened: **Brevo** (volume-billed, recommended default) vs **Listmonk + Amazon SES** (self-hosted ~$8–20/mo). Mailchimp/Klaviyo ruled out. Marketing = Phase 5, deferred. | **Current engine position — and the thing being re-opened now.** |
| 2026-07-14 | `PLAN-Templates-Consent.md` | WhatsApp templates + per-channel marketing consent. Public opt-in page deferred until engine chosen. | **BUILT** (templates + consent live). Opt-in page still deferred. |

> **Important:** the client's "new" WhatsApp-funnel requirement is not new — it is
> `WHATSAPP_META_PLAN.html` from May/June, which was written **before** the Supabase comms spine
> existed and therefore assumed we'd build the funnel from scratch on Omnisend. Most of its
> "what's missing" list has since been built for other reasons.

---

## 2. How the idea drifted

1. **May:** marketing = "dump leads into Omnisend, let Omnisend do email/SMS + retargeting." Omnisend
   is the engine and the analytics layer.
2. **June:** WhatsApp added as a first-class funnel channel (client's 9 June update). Omnisend has no
   WhatsApp, so WhatsApp marketing is carved out to Twilio → **split-brain begins**.
3. **10–11 July:** client rejects per-contact pricing. Omnisend AND Klaviyo out. The analytics layer
   moves **into our own Supabase spine** so the sending tool becomes swappable. Engine = open question.
4. **14 July:** discovery that **Klaviyo *and* Omnisend are both actually installed** on the Shopify
   store — so the "we have no engine" premise may be wrong. Marked as a blocker; unresolved.
5. **16 July (now):** client re-prioritises the **Meta → WhatsApp funnel** as "a very important part
   of our system" — which pulls marketing back to WhatsApp-first, where Brevo was weakest anyway.

**Net drift:** engine choice went `Omnisend → nothing → Brevo?`, while the channel that matters most
to the client went `email/SMS → WhatsApp`. The Brevo recommendation was made **before** WhatsApp
became the priority channel. That's the main reason to re-review — see §5.

---

## 3. Ground truth — what is actually built and deployed today

This is the part the old plans do not reflect. All of this is live in production:

| Capability | State |
| --- | --- |
| Supabase comms spine (contacts / threads / messages / voice_calls / events) | **Built.** Source of truth, RLS deny-by-default. |
| WhatsApp inbound + outbound (Twilio), delivery/read status callbacks | **Built.** `api/whatsapp/inbound.js`, `send.js`, `api/twilio/status-callback.js`. |
| Provider abstraction — Twilio **and** Meta Cloud API both implemented | **Built.** `lib/whatsapp.js` `getProvider()`, `sendTwilioWhatsApp()` / `sendMetaWhatsApp()`, signature verification for both, `parseWhatsAppInbound()` handles both payload shapes. Currently running Twilio. |
| AI reply on WhatsApp (ElevenLabs text agent + KB + Shopify context) | **Built.** `askElevenLabsTextAgent()` in the inbound path. |
| 3-pane inbox with real-time view of customer + AI messages | **Built.** `src/pages/InboxPage.jsx`. |
| Operator takeover without losing context | **Built.** Auto-takeover on human send, 30-min rolling AI pause, auto-handback (`AI_TAKEOVER_MINUTES`). |
| WhatsApp templates (Meta-approved, read live from Twilio Content API) | **Built.** 4 approved: `support_followup`, `order_enquiry_update` (UTILITY), `quote_ready`, `reengage_offer` (MARKETING). |
| Per-channel marketing consent + STOP/START capture | **Built.** `lib/comms/consent.js`; Shopify is source of truth for email+sms. |
| Lead → Shopify customer push | **Built.** `lib/shopify-whatsapp-leads.js` `upsertWhatsAppLead()`. |
| ChatGPT MCP comms tools | **Built.** 6 tools live. |
| **CTWA referral capture (`ctwa_clid`, ad id, source url)** | **MISSING — zero references anywhere in the codebase.** |
| **Funnel/scenario state machine (qualification steps)** | **MISSING.** Today it's one stateless AI agent + KB, no funnel stages, no lead scoring. |
| **Media sending (video / PDF / images)** | **MISSING — and explicitly SKIPPED by user decision 2026-07-13** ("inbox stays text+links"). ⚠ **Directly contradicts the new client requirement.** See §6. |
| **Meta CAPI conversion loop (send purchase back to Meta)** | **MISSING.** |
| **Bulk campaigns / segments / broadcast** | **MISSING** (P3 intentionally skipped). |
| Email channel | **BLOCKED** — no `GOOGLE_*` env in prod. |

---

## 4. Client's new requirement, mapped

Client's scenario (2026-07-16) vs reality — **4 of 7 already exist**:

| # | Client requirement | Status |
| --- | --- | --- |
| 1 | Sees ad in Meta (FB/IG), clicks Contact / Send WhatsApp | Ad side = client/Meta setup, not code. **Needs CTWA ad + WABA link.** |
| 2 | Opens dialog with our WhatsApp bot | ✅ **Built** |
| 3 | Bot works **through our system**, not separately | ✅ **Built** — this is exactly the Supabase spine |
| 4 | We see the whole conversation in real time (customer + AI) | ✅ **Built** — the inbox |
| 5 | AI follows a **scenario**, qualifies the lead, sends links/products/**video/PDF**/promos, drives to purchase | ⚠️ **Partial.** Links/products = built (CTA cards). **Scenario engine = missing. Video/PDF = missing + previously skipped.** |
| 6 | Operator can join anytime **without losing context** | ✅ **Built** — auto-takeover |
| 7 | Full path from ad click → order | ⚠️ **Attribution missing** — no `ctwa_clid`, no CAPI. Checkout links exist. |

**So the real new build is only:** (a) CTWA referral capture + attribution, (b) a funnel/scenario
engine, (c) media (video/PDF) sending, (d) Meta CAPI conversion loop.

---

## 5. What research (2026-07-16) changes about the old plans

Three findings materially change decisions made earlier:

1. **The Twilio-vs-Meta-Cloud-API fork in `WHATSAPP_META_PLAN.html` is resolved — stay on Twilio.**
   That doc's main argument for migrating to Meta Cloud API was that Click-to-WhatsApp ads needed it.
   Twilio now exposes **`ReferralCtwaClid`** on inbound webhooks from CTWA ads (plus referral
   `source_id`/`source_type`/`source_url`/`headline`/`body`), explicitly so it can be fed to Meta's
   Conversions API. **No migration needed.** We keep the Twilio sender, templates, and approvals.

2. **Brevo is dead — superseded by the 2026-07-16 decision (§6.1): Klaviyo removed, Omnisend kept.**
   Recorded for the record: Brevo's WhatsApp campaigns are Professional-plan only (~$499/mo), so
   buying Brevo would never have gotten us WhatsApp anyway — that stays on Twilio regardless. Brevo
   was recommended *as a volume-billed email/SMS engine* before WhatsApp became the priority channel.
   Moot now: the client already pays for Omnisend, which covers the same email job.

3. **Meta moved to per-message pricing (from 1 Jul 2025); service messages inside the 24h window are
   free.** Reported (⚠ **verify at Meta's pricing doc before quoting the client**): a CTWA-originated
   conversation opens a **free entry point window (~72h) where all messages including templates are
   free**. If true, this is the single strongest economic argument for the CTWA funnel — the entire
   qualification conversation costs ~nothing, and it changes the ROI case vs email/SMS marketing.
   Further Meta pricing changes are flagged for **1 Aug 2026 and 1 Oct 2026** — re-check before launch.

---

## 6. Open decisions for tomorrow's session

### 6.1 — RESOLVED (2026-07-16): Klaviyo removed, Omnisend stays
Client decision: **Klaviyo will be removed. Omnisend has a live subscription and is in use** — so it
should be used where it fits. This kills the engine debate: **Brevo and Listmonk+SES are both off the
table.** We do not buy a new tool for a channel the client didn't ask for. Omnisend is already paid
for and already natively synced to Shopify.

⚠ **Before pulling Klaviyo, check what it is actually doing.** The 2026-07-14 discovery was that a
Shopify consent write triggered a real double opt-in email from `shared.klaviyomail.com` — meaning
Klaviyo has **live flows**, not just an idle install. Removing it will silently kill whatever
automations are running there. Do this first: list Klaviyo's active flows/campaigns, confirm Omnisend
covers each one (or that it's dead weight), then uninstall. Two ESPs syncing the same Shopify
customers also means customers may be receiving duplicates *right now* — worth checking as part of
the audit.

### 6.2 — Omnisend's limitations for this plan (what it can't cover)

| Channel / need | Omnisend? |
| --- | --- |
| **WhatsApp** — our priority channel | ❌ **No native WhatsApp channel.** Omnisend's own help centre documents WhatsApp only via a **third-party partner (Chatarmin)**. Its native workflow channels are email, SMS, web push. **We would never route WhatsApp through it** — we own WhatsApp on Twilio + the spine. |
| **Voice** (ElevenLabs calls) | ❌ Not a channel it has. Ours. |
| **Widget / site chat** | ❌ Ours. |
| **SMS** | ⚠️ **Pro plan only since 2026-05-04.** If the client is on **Standard, they have no SMS through Omnisend at all** → all SMS stays on Twilio. If Pro, SMS credits ≈ subscription price, from ~$0.007/SMS. **Need to know the plan.** |
| **Email marketing** (bulk campaigns, abandoned cart, order/shipping flows, web push) | ✅ **This is what it's good at, and it's already paid for. Use it here.** |
| **Cost model** | ⚠️ **Per-contact billing** — this was the original rejection reason. Scales on contacts *stored*, not sent (~$16 at 500, ~$132 at 10k contacts on Standard; Pro from $59 at 2.5k). Already sunk if the subscription is live, but it caps how big the list can get before it hurts. |
| **Funnel analytics** | ⚠️ **Siloed.** Engagement data lives in Omnisend, not our spine. For one unified ad→order funnel view we must pull its events into Supabase `events` via API/webhook. |
| **Meta ad-audience sync** (retargeting) | ⚠️ **Unverified and thinner than Klaviyo's** — flagged for a spike in July, never done. **Removing Klaviyo removes the deeper option**, so if retargeting audiences matter, either confirm Omnisend's depth or plan to push audiences ourselves via our own Meta CAPI feed (which we need for the funnel anyway — see §6.5). |

**Resulting split (recommended):**
- **Omnisend** = email marketing engine + web push. Bulk campaigns, abandoned cart, post-purchase.
- **Twilio + our spine** = WhatsApp (the CTWA funnel), 1:1 SMS, voice, widget chat, operator inbox.
- **Supabase spine** = the unified analytics layer; pull Omnisend engagement in so the funnel is whole.
- **Meta CAPI** = ours, not Omnisend's — needed for CTWA attribution regardless.

**Open:** which Omnisend plan + current contact count? That decides the SMS lane and the real cost.

### 6.3 — Media (video/PDF) reverses a prior decision
Client explicitly wants the AI to send **video, PDF, promos**. On 2026-07-13 attachments/media were
**skipped by user decision** — inbox is text+links only. Sending media needs publicly-reachable
`MediaUrl` hosting (Supabase Storage bucket, or Shopify Files CDN). The May plan's "20–50 reusable
product clips" implies a **content production workload on the client's side**, not just code.
**Needs an explicit reversal + a decision on who produces the clips.**

### 6.4 — Scenario engine: how much structure?
Fork: (i) prompt-only — extend the ElevenLabs agent with funnel instructions (fast, fuzzy, no state);
(ii) explicit state machine on the spine (`threads.funnel_stage` + lead score, deterministic sends,
analytics per stage). The client's "заранее продуманному сценарию" + "квалифицирует лид" implies (ii).
**Needs the actual scenario content from the client** — questions, qualification criteria, product
paths, which asset at which step.

### 6.5 — Attribution depth
Minimum: capture `ReferralCtwaClid` + referral fields on inbound, store on thread/contact. Full loop:
fire Meta CAPI events (`action_source: business_messaging`, `messaging_channel: whatsapp`) on
lead-qualified + purchase, so Meta optimises on real orders, not just "conversations started".
**Also open:** Meta Pixel on the storefront was "need to verify" in May and was never confirmed.

### 6.6 — Not yet answered
- Which WhatsApp number the funnel uses (existing support number vs a dedicated ads number — mixing
  ad traffic with support traffic affects number reputation and reporting).
- Does the client have Meta Business verification done (needed above 250 conversations/day)?
- Who owns the WABA — client's Meta Business or ours?

---

## 7. Suggested agenda for tomorrow

1. ~~Daniel's answer on Klaviyo/Omnisend~~ — **done 2026-07-16**: Klaviyo out, Omnisend stays (§6.1).
   Remaining: audit Klaviyo's live flows before uninstalling, and get the Omnisend plan + contact count.
2. Confirm the channel split (§6.2): Omnisend = email/push only; WhatsApp + SMS + voice = Twilio/spine.
3. Walk the funnel end-to-end: ad → CTWA click → referral capture → scenario → qualification →
   asset delivery → checkout link → order → CAPI event back to Meta.
4. Get the **scenario content** from the client (§6.4) — this is the long pole and it's their homework.
5. Decide media hosting + who produces the video/PDF assets (§6.3).
6. Re-verify Meta pricing/free-entry-point before any ROI claim (§5.3).

---

## 8. Related docs

`PLAN-CommsControlCenter.md` (spine + engine debate) · `WHATSAPP_META_PLAN.html` (original funnel
intent) · `PLAN-Templates-Consent.md` (templates/consent, built) · `LEAD_CAPTURE_PLAN.html` (lead
capture, built) · `WHATSAPP_TWILIO_TEMPLATES.md` (approved template SIDs).
