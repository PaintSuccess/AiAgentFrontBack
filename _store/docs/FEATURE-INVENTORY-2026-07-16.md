# Master Feature Inventory — everything the system should support

**Date:** 2026-07-16 · **Purpose:** every feature ever specified across the plan history, in one list,
with what's actually true today. Built from: `LEAD_CAPTURE_PLAN.html` (Plan #1, 05-20),
`WHATSAPP_META_PLAN.html` (Plan #2, 05-18→06-27), `OPS_PRICING_PLAN.html` (Plan #3, 05-20),
`GOOGLE_PLACES_VOICE_AGENT_PLAN.html` (05-25), `PLAN-FullSystem.md`, `DASHBOARD_PLAN.md`,
`PLAN-CommsControlCenter.md` (07-10→13), `PLAN-InboxFeatures.md`, `PLAN-Templates-Consent.md`,
`PLAN-HumanHandoff.md`, `PLAN-OnScreenOrders-Handoff.md`, `PLAN-EmailTab.md`, + client req 07-16.

**Legend:** ✅ built & live · 🟡 partial · ❌ missing · ⏸ parked by decision · 🗑 dropped/superseded

---

## A. Channels (transport)

| # | Feature | Status | Notes / source |
| --- | --- | --- | --- |
| A1 | Website widget — **voice** | ✅ | ElevenLabs (Jessica) |
| A2 | Website widget — **text chat** | ✅ | |
| A3 | **Phone voice** inbound (Twilio → ElevenLabs) | ✅ | |
| A4 | **Phone voice outbound**, recorded + transcribed | ✅ | `lib/comms/call.js`, Phase 3 |
| A5 | **SMS** inbound + outbound + AI reply | ✅ | `api/twilio/sms-*.js` |
| A6 | **WhatsApp** inbound + outbound + AI reply | ✅ | `api/whatsapp/*.js` |
| A7 | Delivery / read status callbacks | ✅ | **Twilio's is sufficient — Meta's is NOT needed.** Twilio is our BSP: Meta pushes receipts to Twilio, Twilio relays them to `/api/twilio/status-callback` as `queued→sending→sent→delivered→read→failed/undelivered` (`read` = blue ticks). Same Meta data, one hop. Recorded via `recordStatus()`; all 3 send paths wired. ⚠ **Latent trap:** Meta delivery status is only needed if `WHATSAPP_PROVIDER=meta` (Cloud API direct) — then no StatusCallback fires and we'd need Meta's webhook `statuses[]`. `sendMetaWhatsApp()` is fully implemented and one env var away, so a future cost-driven switch would **silently freeze all ticks at "sent"** with no error. ⚠ **Dead code:** `api/whatsapp/status.js` is orphaned (console.log only, never writes DB, nothing points at it) — legacy from Plan #2, which still calls it "Implemented". Check the Twilio Console isn't still pointing a service-level status callback at it. |
| A8 | Provider abstraction (Twilio **and** Meta Cloud API) | ✅ | `lib/whatsapp.js` — both implemented + signature-verified; running Twilio |
| A9 | **Email** as a conversational channel | ❌ **BLOCKED** | No `GOOGLE_*` env in prod → Gmail backend dead. `PLAN-EmailTab.md` |
| A10 | Web push | ❌ | Would come free with Omnisend |
| A11 | **Instagram DM** | ❌ | *Requested 07-16.* Feasible — direct Meta only, **not** via Twilio. See §A-bis |
| A12 | **Facebook Messenger** | ❌ | *Requested 07-16.* Feasible — Twilio Conversations **or** direct Meta. See §A-bis |
| A13 | **Shopify Inbox** | ❌ | *Requested 07-16.* ⚠ **No public API + overlaps our own inbox.** See §A-bis |
| A14 | **TikTok Messages** | ❌ | *Requested 07-16.* Partner-gated; AU eligible. Spike, not a plannable build. See §A-bis |

## A-bis. Channel expansion — feasibility (added 2026-07-16 at client request)

**The good news first:** the spine already does the hard part. A new channel is an **ingest adapter +
a send adapter + a `channel` enum value** — threading, contact resolution, AI reply, operator
takeover, auto-handback, consent, and the inbox UI are all channel-agnostic and already built. This
is exactly what the Supabase-spine design was for. The cost of a new channel is now small; the
**feasibility is entirely about what each platform's API allows**, and they differ wildly.

Also note: **Instagram, Messenger and WhatsApp all share the same 24-hour-window model** as WhatsApp
(free-form inside the window, restricted outside). Our existing window/template logic generalises.

### A11 — Instagram DM ✅ *most valuable of the four*
- **API:** Meta **Instagram Messaging API** (Graph API). **Not supported by Twilio Conversations** —
  this must be a direct Meta integration, unlike Messenger.
- **Requires:** Instagram **Business/Creator** account linked to a Facebook Page we admin;
  `instagram_business_manage_messages` permission; **Meta App Review** for production.
- **Rules:** webhook fires on inbound; **the user must message first** (no cold outreach); 24h
  free-form window, then Human Agent tag up to 7 days (support only). 200 req/hour per IG account.
- **Why it matters most:** **Click-to-Instagram-Direct ads are the sibling of CTWA.** The client is
  already running Meta ads — the exact same ad→DM→AI→qualify→checkout funnel works here, on the same
  spine, with the same scenario engine. If we build the funnel for WhatsApp, IG is largely a second
  adapter, not a second project. Strong candidate for **phase 2 of the funnel**.

### A12 — Facebook Messenger ✅ *easiest*
- **Two paths:** **Twilio Conversations** supports Messenger (long-running public beta) → reuses our
  existing Twilio relationship and status-callback pattern; **or** direct Meta Messenger Platform
  (Send API + webhooks, `pages_messaging`, App Review).
- **Rules:** same 24h window + Human Agent tag model.
- **Note:** Meta ads can click-to-Messenger too, so it's the third leg of the same ad funnel.
- **Recommendation:** if we go direct-Meta for Instagram anyway, do Messenger direct too — one Meta
  app, one App Review, one webhook shape. Don't split across two vendors for two Meta channels.

### A13 — Shopify Inbox ⚠️ *the awkward one — recommend NOT integrating*
- **There is no public API to read or send Shopify Inbox conversations.** `shopify.dev/api/messaging`
  does not document a public messaging API. This matches the existing note in `CLAUDE.md`: *"Shopify
  Inbox is not currently exposed by the PaintAccess Operations MCP."*
- **It is a competitor to what we built, not a channel.** Shopify Inbox is itself an aggregator —
  online-store chat + Facebook Messenger + email in one box. That is our inbox's job.
- **Direct conflict:** our ElevenLabs widget already occupies the storefront chat slot. Running
  Shopify Inbox chat alongside it = **two chat widgets on the same store**.
- **The real question is not "can we integrate it" but "is the client using it right now?"** If yes,
  those conversations are **invisible to us and to the AI** — a live blind spot, and the same
  split-brain problem we found with Klaviyo/Omnisend. **Ask Daniel whether Shopify Inbox chat is
  enabled on the storefront.** If it is, the answer is probably to turn it off, not to integrate it.
- If Messenger is wired via A12, we'd cover the useful half of what Shopify Inbox aggregates anyway.

### A14 — TikTok Messages ⚠️ *possible, but gated — spike only*
- **A TikTok Business Messaging API does exist** (`business-api.tiktok.com/portal/docs/direct-messages`)
  — send/receive DMs, automated replies, thread management.
- **But it is gated to approved API-integrated platforms/partners**, not open self-serve. Other
  sources state flatly that TikTok's general developer API does not expose DMs for privacy reasons,
  and that TikTok Shop messaging is a separate, separately-gated track.
- **Availability:** Business Accounts registered **outside the US, EEA, Switzerland and the UK** —
  **Australia is eligible.** Personal accounts and restricted regions are not.
- **Verdict:** treat as a **research spike**, not a plannable build. Cost is unknown until we know
  whether PaintAccess (or we) can get TikTok partner approval. **Do not promise this to the client**
  until that's answered. Also worth asking whether they even run TikTok ads — if not, this is
  speculative.

### Suggested channel priority
1. **WhatsApp / CTWA** — committed, in progress.
2. **Instagram DM** — same ad funnel, same spine, high reuse. Needs Meta App Review (start early — it
   takes time).
3. **Facebook Messenger** — cheap add-on once the Meta app exists.
4. **Shopify Inbox** — *audit, don't build.* Find out if it's on; likely turn it off.
5. **TikTok** — spike only, gated, may be impossible.

**Cross-cutting dependency:** Instagram + Messenger both need a reviewed Meta app. That's a
lead-time item, not a build item — **worth starting the App Review process before we need it.**

## B. Conversation core (the spine)

| # | Feature | Status | Notes |
| --- | --- | --- | --- |
| B1 | Persistent conversation store (contacts/threads/messages/voice_calls/events) | ✅ | Supabase, RLS deny-by-default |
| B2 | One thread per contact, cross-channel | ✅ | |
| B3 | Cross-channel customer identification | ✅ | by phone/email → Shopify customer |
| B4 | Conversation history in AI context | ✅ | `loadTwilioTextHistory` + customer context |
| B5 | Past orders + support history in AI context | ✅ | `getCustomerContextByPhone` |
| B6 | Idempotent ingestion (dedupe by provider id) | ✅ | |
| B7 | Historical backfill | ✅ | 66 voice calls + messages threaded |
| B8 | Unified `events` table for funnel analytics | 🟡 | **Correction (07-16): better than first reported.** Message-lifecycle events **are** logged automatically by `store.js` — `message_received`, `message_sent`, and `message_{delivered,read,failed}` via `recordStatus`. So volume / delivery-rate / response-time analytics are **already possible from existing data**. What's missing is **business/funnel events** (ad referral, lead qualified, checkout started, order placed) + marketing engagement pulled from Omnisend. |
| B9 | Ingestion latency (~10 sequential round-trips, 300–600ms) | 🟡 | fail-safe, acceptable, optimise later |

## C. Operator inbox + human handoff

| # | Feature | Status | Notes |
| --- | --- | --- | --- |
| C1 | 3-pane hub (channel tabs, list, bubbles, contact panel) | ✅ | `InboxPage.jsx` |
| C2 | **Real-time view of customer + AI messages** | ✅ | *client req #4* |
| C3 | **Operator takeover without losing context** | ✅ | *client req #6* — auto-takeover on human send |
| C4 | Rolling 30-min AI pause + auto-handback | ✅ | `AI_TAKEOVER_MINUTES` |
| C5 | Free-text send (SMS/WhatsApp) from inbox | ✅ | |
| C6 | Folders, status (Open/Pending/Closed), star/pin, labels | ✅ | |
| C7 | Assignment (assign-to-me / unassign) | 🟡 | single-user; **multi-staff dropdown deferred** (Shopify Plus-only staff API) |
| C8 | Quick replies / canned responses | ✅ | |
| C9 | Per-channel unread badges + counts | ✅ | |
| C10 | Server-side search (contacts + message bodies) | ✅ | |
| C11 | Contacts directory + Shopify write-back (name/email/tags/notes) | ✅ | |
| C12 | Product-link CTA cards | ✅ | |
| C13 | Voice call cards w/ duration + expandable transcript | ✅ | |
| C14 | **"Connect me to a human" escalation** — Option 1 wa.me deep-link | ✅ | `lib/comms/handoff.js` |
| C15 | Option 2 — auto-created WhatsApp group (customer+Daniel+manager) | ⏸ | documented, not built |
| C16 | **On-screen order card in widget** (voice/text) | ❌ | `PLAN-OnScreenOrders-Handoff.md` — agent *claims* it shows; nothing appears |
| C17 | **On-screen "Chat on WhatsApp" button** in widget | ❌ | same doc — known broken promise |
| C18 | Rate limit on `/api/comms/send` | ❌ | admin-authed, low risk |
| C19 | Unread-count lost-update under concurrency | 🟡 | known |

## D. AI agent capability

| # | Feature | Status | Notes |
| --- | --- | --- | --- |
| D1 | Tools: `lookup_order`, `search_products`, `check_inventory`, `send_email_notification` | ✅ | |
| D2 | `send_sms_notification` | ✅ | |
| D3 | `escalate_to_human` | ✅ | |
| D4 | Knowledge Base + RAG index (auto docs retrievable) | ✅ | fixed 07-15 — was silently broken |
| D5 | **Text-channel prompt variant** (async, mobile-formatted, not voice's 1–3 sentences) | ❓ | specified in Plan #2 — **needs verification** |
| D6 | **Funnel steps as agent states** (greeting→qualify→recommend→quote→checkout) | ❌ | *client req #5* — **no state anywhere** |
| D7 | **Conversation state store** (which funnel step each customer is on) | ❌ | Plan #2 called this out; `funnel_step`/`lead_score` don't exist |
| D8 | Lead **qualification** + scoring | ❌ | *client req #5* |
| D9 | Agent tool: `send_whatsapp_template` (proactive re-engage outside 24h) | 🟡 | exists as **MCP** tool + UI; **not** an ElevenLabs agent tool |
| D10 | Agent tool: `create_draft_order` (+ payment link over WhatsApp) | 🟡 | `api/callback.js` does draft orders but is **disabled** (`ENABLE_AI_CALLBACK` unset) + compliance-gated |
| D11 | Agent tool: `send_catalog_item` (WhatsApp Catalogue product card) | ❌ | |
| D12 | Interactive messages (reply buttons / list messages) | ❌ | Plan #2 flagged button limits → use lists for many branches |
| D13 | **24-hour window tracker** (free reply vs paid template) | 🟡 | UI banner exists; no per-customer server-side timer driving logic |
| D14 | Inbound media handling (customer sends paint photo / voice note → vision/STT) | ❌ | Plan #2 wanted it |
| D15 | Google Places — "find a painter near me" during call | ⏸ | whole plan parked (05-25) |

## E. WhatsApp / Meta funnel ⭐ *the new priority*

| # | Feature | Status | Notes |
| --- | --- | --- | --- |
| E1 | Production WhatsApp sender (not sandbox) | ✅ | Twilio; OBA verified 07-15 |
| E2 | Approved message templates | ✅ | 4 live: `support_followup`, `order_enquiry_update` (UTILITY), `quote_ready`, `reengage_offer` (MARKETING); read live from Twilio Content API |
| E3 | **Bot runs through our system, not separately** | ✅ | *client req #3* — the spine |
| E4 | **Meta ad → Click-to-WhatsApp → our bot** | ❌ | *client req #1* — ad + WABA link is client/Meta setup |
| E5 | **Capture `ReferralCtwaClid` + referral (source_id/url/headline/body)** | ✅ *(built 07-16)* | `parseTwilioReferral()` / `parseMetaReferral()` in `lib/whatsapp.js`. Param names verified against Twilio docs (`ReferralCtwaClid`, `ReferralSourceId/Type/Url`, `ReferralHeadline`, `ReferralBody`, `ReferralMedia*`). `ReferralNumMedia` deliberately unused — Twilio announced its removal. `scripts/test-referral-capture.js` 15/15. |
| E6 | Store referral/ad attribution on thread/contact | ✅ *(built 07-16)* | 3 places: `contacts.first_referral` (first touch, write-once, `is null` guarded), `events` type `ad_referral` (every touch), `messages.metadata.referral` (raw). Migration **0005 — NOT YET APPLIED to prod**. Capture is guarded so a missing column logs loudly but cannot break the message path. |
| E7 | **Meta CAPI events** (`Lead`, `InitiateCheckout`, `Purchase`; `action_source: business_messaging`) | 🟡 *(recon 07-16)* | **CAPI is already connected** — Events Manager lists "Conversions API • Meta pixel" (via the Shopify Meta app). ⚠ Meta flags `s2s_low_event_coverage_actions`: poor dedup, and fixing it is worth **~15.2% lower cost per result**. Still missing: **`business_messaging` CAPI** (`action_source: business_messaging` + `ctwa_clid`) for the WhatsApp funnel — different source, nothing else supplies it. So Path A is additive to an existing integration on the same pixel. |
| E8 | Meta Pixel on storefront | ✅ **RESOLVED 07-16** | **Live: `334352823575129`** ("PaintAccess's Pixel", business `1953771224878899`), ~4–6k events/day, `www.paintaccess.com.au` +9 domains, 4 catalogues. ⚠ **Decoy:** a dataset *named* "PaintAccess" (`1230318080842197`) in ad account `257491584421899` is an **App** dataset reading "Inactive — never received event". Checking that one wrongly concludes there's no tracking. ⚠ 62 unconfirmed domains sending data (incl. **`247games.com`** — not ours); don't blanket-allowlist. |
| E8b | **Our own storefront web pixel** | ❌ **the real gap** | Meta, Google (`G-1V61SH5WFD`+`GT-5D9QV8NS`), TikTok (`CLI8693C77U8PKBK1BG0`) and Omnisend (`69394d3da929c7e42620aa30`) all have a live pixel with full Protected-Customer-Data scopes + `share_all_events`. **We have none** — the system meant to own the single customer profile is the only party with no storefront visibility. This, not GA, is what "AI sees what they browsed" actually needs. |
| E9 | Click-to-WhatsApp link/CTA on product pages | ❌ | |
| E10 | Shopify metafield `whatsapp_phone` (join key) | ❌ | |
| E11 | Tag taxonomy: `WhatsApp` / `WhatsApp Lead` / `WhatsApp Customer` | 🟡 | leads tagged; full taxonomy unconfirmed |
| E12 | Checkout link / draft order over WhatsApp | 🟡 | see D10 |
| E13 | Dedicated ads number vs shared support number | ❓ | **undecided** — affects reputation + reporting |
| E14 | Meta Business verification (>250 conv/day) | ❓ | portfolio verification OK 07-15; messaging tier unconfirmed |

## F. Media / video library

Plan #2 (June) contains a **fully-designed architecture** for this — it was answered to the client in
Russian. It then got skipped on 07-13. Client now asks for video/PDF again → **reversal needed.**

| # | Feature | Status | Notes |
| --- | --- | --- | --- |
| F1 | **Send video / PDF / images to customer** | ⏸→❗ | *client req #5* — **skipped 07-13**, now required again |
| F2 | Canonical media library (Cloudflare R2 + CDN; S3+CloudFront alt) | ❌ | Plan #2: **do not use Shopify Files as source of truth** |
| F3 | Media registry (`asset_key`, `funnel_step`, `cdn_url`, `sha256`, `whatsapp_media_id`, `media_id_expires_at`) | ❌ | |
| F4 | `whatsapp_media_id` cache + auto-refresh (IDs expire ~30d) | ❌ | send by id → fallback re-upload → fallback CDN link |
| F5 | Native WhatsApp video attachment (not a link) | ❌ | <16MB, MP4 H.264 Main/Baseline + AAC, `faststart`, avoid High-profile B-frames |
| F6 | `/api/whatsapp/send-video` adapter | ❌ | |
| F7 | Encoding validation before publish | ❌ | |
| F8 | **20–50 reusable clips** (demo, testimonials, kit contents, batteries, objections, checkout nudges) | ❌ | **client-side content production** — the real long pole |
| F9 | Same library reused by web funnel / email / landing pages | ❌ | |

## G. Lead capture + CRM

| # | Feature | Status | Notes |
| --- | --- | --- | --- |
| G1 | Capture name/email/phone in conversation | ✅ | |
| G2 | Push to Shopify Customers (create/update), tagged | ✅ | `upsertWhatsAppLead()` |
| G3 | `write_customers` / `read_customers` scopes | ✅ | |
| G4 | Post-call webhook logs conversation (not mid-call — latency) | ✅ | `elevenlabs-post-call.js` |
| G5 | Log the journey (what they asked, interest, outcome) | 🟡 | transcripts stored; **no structured interest/outcome** |
| G6 | Email confirmation step (STT confuses j/g, five/nine) | ❓ | edge case flagged in Plan #1 — verify prompt handles it |
| G7 | Duplicate-customer logic (lookup by email → update, else create) | ✅ | |
| G8 | **UTM / referrer capture** ("where did the lead come from") | ❌ | flagged May; still missing → same gap as E5 |
| G9 | "Did they buy" attribution back onto the customer record | ❌ | |

## H. Consent + compliance

| # | Feature | Status | Notes |
| --- | --- | --- | --- |
| H1 | Per-channel consent (email/sms/whatsapp/calls, do_not_call) | ✅ | migration 0004 |
| H2 | STOP / START keyword capture | ✅ | wired into sms + whatsapp inbound |
| H3 | Shopify as source of truth for email+sms consent | ✅ | write-first, then mirror |
| H4 | Australian Spam Act / GDPR opt-in record | ✅ | "AI Agent tag ≠ consent" — honoured |
| H5 | **Block marketing send to non-consented contact** | ❌ **DO NOT wire into `send.js`** | `canSendMarketing` is exported but called only by its own test — confirmed dead. ⚠ **Audit 07-16 rejected the obvious fix.** `send.js sendMessage()` is the single path for *human operator replies* as well as template sends, and `quote_ready` is a **MARKETING-category** template an operator legitimately sends when a customer **asked** for a quote — gating on `tpl.category === 'MARKETING'` would block it. That's a live regression, not a safe win. Also `canSendMarketing` needs the DB contact row (consent columns); `send.js`'s `contact` param is a caller-supplied identity object, so it'd need a lookup + a fail-open/fail-closed decision. **Correct scope: enforce on the future bulk/broadcast path (I5/I6), which doesn't exist yet.** A 1:1 reply to a customer's own request is not marketing, whatever Meta's template category says. |
| H6 | Public opt-in / preference page (in theme, signed token) | ⏸ | deferred until engine chosen → **engine now chosen (Omnisend)**, so unblocked |
| H7 | WhatsApp opt-in via affirmative reply (Meta requirement) | ❌ | |
| H8 | Do Not Call Register check (outbound calls) | ❌ | gates `api/callback.js` |

## I. Marketing + analytics

| # | Feature | Status | Notes |
| --- | --- | --- | --- |
| I1 | Email marketing engine | ✅ *(external)* | **Omnisend** — decided 07-16; already paid, natively Shopify-synced |
| I2 | Klaviyo | 🗑 | being removed — ⚠ audit live flows first |
| I3 | Brevo / Listmonk+SES / Mailchimp | 🗑 | all off the table |
| I4 | Bulk SMS marketing lane | ❓ | Omnisend SMS is **Pro-only since 2026-05-04** → if Standard, all SMS on Twilio |
| I5 | WhatsApp broadcast to a segment | ❌ | must be ours (Omnisend has no native WhatsApp) |
| I6 | Campaigns / segments / `campaign_recipients` tables | ❌ | specified in CommsControlCenter §3 |
| I7 | **Funnel analytics** sent→delivered→opened→clicked→returned→lead/order | ❌ | needs `events` populated (B8) + Omnisend events pulled in |
| I8 | Revenue attribution | ❌ | |
| I9 | Auto retargeting audiences → Meta/Google Custom Audiences | ❌ | Omnisend's ad-audience sync **unverified + thinner than Klaviyo's** → likely push via our own CAPI |
| I10 | MCP `marketing_*` tools (create_segment, send_campaign, get_analytics, build_audience) | ❌ | |
| I11 | Analytics tab (volumes, response times, AI-vs-human, delivery rates) | ⏸ | P3 skipped |
| I12 | Automations tab (rule builder: auto-tag, auto-assign, keyword routing) | ⏸ | P3 skipped |
| I13 | Templates manager UI (CRUD) | ⏸ | P3 skipped |
| I14 | Broadcasts UI | ⏸ | P3 skipped |
| I15 | Abandoned cart / post-purchase flows | ✅ *(external)* | Omnisend prebuilt |

## J. Back-office — separate track (Plan #3, not this project)

| # | Feature | Status |
| --- | --- | --- |
| J1 | Operations automation (supplier PO, confirmations, payments, tracking) | 🟡 partly live via Operations Desk MCP + `.agents/skills/` |
| J2 | Pricing intelligence (guard rails: ±15% max, never below cost×1.10) | ❌ parked |
| J3 | ChatGPT Operations Desk MCP (Shopify/Gmail/Drive) | ✅ live |

---

## Summary — what actually needs building for the client's funnel

Everything else above is either done, external, or parked. The funnel needs **four** things:

1. **CTWA attribution** (E5–E7): capture `ReferralCtwaClid` on inbound → store on thread → fire Meta
   CAPI on qualify/purchase. Small, high leverage, unblocks all ad reporting.
2. **Funnel/scenario engine** (D6–D8): funnel state + qualification + lead score. **Blocked on the
   client giving us the actual scenario.**
3. **Media pipeline** (F1–F8): reverse the 07-13 skip; R2 + registry + media_id cache. **Blocked on
   the client producing 20–50 clips.**
4. **Enforced consent + events** (H5, B8, I7): so marketing sends are legal and the funnel is measurable.

**Two known lies to the customer worth fixing regardless** (C16/C17): the agent says "I showed the
WhatsApp on your screen" and "I've put the order on screen" — and nothing appears.
