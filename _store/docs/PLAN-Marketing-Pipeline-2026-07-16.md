# Marketing Pipeline — current picture & available paths

**Date:** 2026-07-16 · **Status: INCOMPLETE BY DESIGN.** This is not a committed plan. It is
everything we currently know, what's actually built, what's still missing, and the realistic paths
forward with their trade-offs. Several decisions are genuinely open and are marked as such.

Companion docs: `PLAN-Marketing-Consolidated-2026-07-16.md` (how the plan drifted, engine decision)
· `FEATURE-INVENTORY-2026-07-16.md` (every feature, built vs missing).

---

## 1. What we now know (settled facts, researched 2026-07-16)

| Fact | Consequence |
| --- | --- |
| **Omnisend is the marketing engine** (client decision) | Engine question closed. Brevo / Listmonk+SES / Mailchimp all off the table. No new tool. |
| **Omnisend has no native WhatsApp** (only via 3rd-party Chatarmin) | WhatsApp — the priority channel — can *only* live in our system. Not a gap in our build; a permanent property of Omnisend. |
| **Omnisend is on the FREE plan** *(browser-checked 2026-07-16)* | 500 emails/mo cap vs **14K email subscribers**; 38.6K contacts / **30,660 billable** / 1,993 SMS subs; hygiene "Poor" (19.5% to clean). **Free = no SMS → bulk SMS runs through Twilio, decided.** But Free also = **can't run a real email campaign** (500/mo), and upgrading to send ≈ **$400/mo at 30,660 billable** — the per-contact blowup that got Omnisend rejected originally. **So "Omnisend is the engine" is now shaky:** installed+syncing but not usable at scale without the spend they wanted to avoid. Fork: clean the list hard / pay the upgrade / move email to a volume-billed sender. Daniel decision. |
| **Twilio relays `ReferralCtwaClid`** on inbound CTWA messages | **No migration to Meta Cloud API needed.** Kills the Path A/B provider fork from the May plan. We keep Twilio, templates, approvals. |
| **Meta went per-message pricing 1 Jul 2025**; service msgs in the 24h window are free | Conversation cost ≈ 0 once a customer writes to us. Cost concentrates in *initiating* (templates). |
| **Reported: CTWA opens a ~72h free entry point** (even templates free) | ⚠ **UNVERIFIED — do not quote to the client yet.** If true it's the single strongest economic argument for this funnel. Verify at Meta's pricing docs. |
| **Further Meta pricing changes: 1 Aug 2026, 1 Oct 2026** | Re-check before launch; don't build an ROI case on today's rates. |
| **Instagram DM is not available via Twilio** — direct Meta only | IG needs its own Meta app + App Review. Messenger can go either way. |
| **Shopify Inbox has no public API** | Can't be integrated. It's a competitor to our inbox, not a channel. |
| **TikTok DM API is partner-gated** (AU eligible) | Spike only. Don't promise. |

### What the live data told us (from the new Marketing page, 61 contacts)

| Signal | Number | So what |
| --- | --- | --- |
| Contacts with **no email at all** | **48 of 61** | Our conversational audience is **phone-first**. An email-led strategy doesn't fit this list (Omnisend's Shopify-sourced list is separate and larger). |
| Email opted in | 4 | Effectively no email marketing audience *from conversations*. |
| SMS / WhatsApp consent "not asked" | 56 / 60 | **The opt-in ask is the bottleneck**, not the sending. Consent growth is the prerequisite for any broadcast. |
| **WhatsApp delivery** | **59% — 30 of 73 settled sends FAILING** | ⚠ Can't market on this channel until fixed. Likely: sends outside the 24h window without a template, or geo permissions. **Investigate before spend.** |
| SMS delivery | 92% | Healthy. |

---

## 0. ⏳ AWAITING DANIEL — re-check when he answers (raised 2026-07-16)

| # | Item | Why it's parked | What to do when he answers |
| --- | --- | --- | --- |
| D1 | **Pixel "62 new domains" diagnostic** | ⚠ **DO NOT create an allow list.** Meta: *"Domains not in the allow list will be blocked from sending events."* None exists today (button reads **"Create Allow List"**), so everything currently flows. Creating one from the 62 would **block `paintaccess.com.au` itself** — it isn't in that list, because it's the *known* domain, not a *new* one. Blast radius: kills live pixel data + ad optimisation. | Recommended: mark the diagnostic **Ignored** (zero risk). It's noise — a browser extension firing the public pixel id across netflix/chatgpt/reddit. If hygiene is ever wanted, use a **block list** (default-allow), never an allow list. |
| D2 | **Two outside businesses can read the pixel data** | Dataset `334352823575129` is shared with business portfolios **Akohub** (`778302942313074`) and **Bold SEO** (`176064029770588`), plus ad account `11731673`. If these are ex-agencies they still have access to customer data. | Ask Daniel if they're current. If not → remove access in Business Settings. |
| D3 | **Automatic Advanced Matching is ON** | Sending Meta hashed **email, phone, name, gender, town/postcode, DOB, External ID**. Probably deliberate (it lifts match rates) but it's a lot of PII and nobody on our side chose it. | Confirm it's intended. |
| D4 | **CAPI low event coverage** | Meta flags bad dedup keys; fixing is worth **~15.2% lower cost per result**. Not fixable in Meta's UI — it's the Shopify Meta app's data-sharing mode (currently **"Optimized"**). Changing it touches **live, working** ad tracking. | Decide whether to move Facebook & Instagram data sharing to "Maximum". Test, don't assume. |

**Facts for whoever picks this up:** PaintAccess business portfolio = `1953771224878899`. Pixel =
`334352823575129`. Pixel creator = Jan Neunzig, 28 Sep 2016. No allow list exists. First-party cookies
on. Core setup off.

---

## 1a. LIVE ACCOUNT RECON (16 Jul) — what's actually already wired

Inspected the live storefront's Shopify web-pixel config + Meta Events Manager (read-only, nothing
changed). **This overturns several assumptions we'd been planning around.**

### ✅ RESOLVED: the Meta Pixel question, open since May

**The pixel is live and busy.** `334352823575129` — "PaintAccess's Pixel", in business portfolio
`1953771224878899`, doing **~4–6k events/day**, attached to `www.paintaccess.com.au` +9 more domains,
with **4 connected catalogues**.

⚠ **Beware the decoy:** the ad account we first landed in (`257491584421899` — Anton's, which also
holds `na-biathlon.ru`, `Rarita`, `Moblermarket`) contains a dataset *named* "PaintAccess"
(`1230318080842197`) that is an **App** dataset reading **"Inactive — never received event"**. That is
NOT the storefront pixel. Anyone checking the wrong account would conclude there's no tracking.

### ✅ Conversions API is ALREADY connected — but underperforming

Events Manager lists **Integrations: "Conversions API • Meta pixel"**. So CAPI is not a greenfield
build. **But Meta's own diagnostics flag it** (detected 4 Jun 2026):

> `s2s_low_event_coverage_actions` — "Improve your rate of Meta Pixel events covered by Conversions
> API… Advertisers with a 75% coverage rate saw **15.2% lower cost per result** vs Meta pixel alone.
> Improve deduplication keys for your pixel and Conversions API events."

**This changes Path A.** Reporting web purchases back to Meta already happens (via the Shopify Meta
app) — it's just poorly deduplicated. What's still genuinely missing is **`business_messaging` CAPI for
the WhatsApp funnel** (`action_source: business_messaging` + `ctwa_clid`), which is a different event
source entirely and nothing else can supply. So Path A remains necessary, but it's *additive to an
existing integration on the same pixel* — cheaper than assumed, and there's a documented cost win
sitting in the dedup fix.

### ⚠ 62 unconfirmed domains are sending data to the pixel

`pixel_new_domains_detected_actions` (detected 5 Jun 2026). Mostly `*.shopifypreview.com` (harmless
theme previews) — **but the list includes `247games.com`, which is not PaintAccess.** Do **not**
blanket-allowlist. Needs a human to confirm which domains are genuinely ours.

### 📊 The full storefront tracking stack (from the live web-pixel config)

| Pixel | ID / config | State |
| --- | --- | --- |
| **Meta** | `334352823575129` (`facebook_pixel`, app 2329312) | ✅ live |
| **Google** | GA4 `G-1V61SH5WFD` + Google Tag `GT-5D9QV8NS` (app 1780363) | ✅ live |
| **TikTok** | pixelCode `CLI8693C77U8PKBK1BG0` (app 4383523) | ✅ **live — TikTok is already tracked** |
| **Omnisend** | brandID `69394d3da929c7e42620aa30` (app 186001) | ✅ live |
| **US (this app)** | — | ❌ **nothing. We have no storefront visibility at all.** |

**Every one of those apps holds full Protected Customer Data scopes** (`read_customer_email`,
`read_customer_name`, `read_customer_phone`, `read_customer_address`, `read_customer_personal_data`)
with `share_all_events`. Shopify is already sharing customer identity with Meta, Google, TikTok and
Omnisend — **just not with us.**

### 🔑 The finding that matters most

**We are the only party in this stack with no eyes on the storefront.** Meta, Google, TikTok and
Omnisend each get the browse/cart/checkout stream. The system we're building to own the *single
customer profile* gets none of it. That is the concrete, buildable gap behind the client's "AI sees
what they browsed" — and it's a Shopify web pixel of our own, not a GA integration.

### What this resolves / changes

- **E8 (Meta Pixel)** — ✅ resolved: live. Remove from blockers.
- **GA4** — the client's "deep GA integration" has a real property to point at (`G-1V61SH5WFD`), though
  §1b's conclusion stands: GA is the wrong tool for the *profile*.
- **TikTok** — not hypothetical. They already run the TikTok pixel, which strengthens the case for
  TikTok as a channel later (and the messaging API is still partner-gated).
- **CAPI** — downgrade from "not built" to "connected but low coverage; messaging events missing".

---

## 1b. Client vision (16 Jul, later same day) — "a marketing system, not a WhatsApp bot"

The client reframed the ask: a **separate marketing AI** holding a **single profile per person**,
unifying WhatsApp + Email + Instagram + Shopify + Google Analytics + ads (Meta, Google), tracking the
whole journey (new vs returning, which ad, what they browsed, cart, purchase, all prior comms),
using cookies/behaviour to auto-segment and pick offers. The ESP should be a dumb **"postman"** —
intelligence stays in our AI, delivery via **Shopify Email** and branded channels. Deep GA from day
one, Meta's own analytics, TikTok later. Explicitly: **"don't do everything at once — break into
small stages, build the architecture, implement block by block."**

### What this is, named plainly

This is a **CDP (Customer Data Platform)** — Segment / RudderStack territory. That's worth saying out
loud, because it sets the true scope.

**The good news: our Supabase spine is already the seed of one.** `contacts` + `events` +
`first_referral` is exactly the right shape — a profile with an event log and a first-touch source.
The architecture we've been building is *correct* for this vision. The scope is ~5–10× larger.

⚠ **The Temu/Alibaba comparison needs a gentle reality check.** Those are first-party apps with
logged-in users and hundreds of engineers. The *principle* (observe behaviour → personalise) transfers.
The *mechanism* does not: a Shopify store cannot see what an anonymous browser did, **by design** —
see the identity limit below.

### ✅ What this genuinely unblocks

1. **"Break into small stages" explicitly endorses incremental delivery.** This validates the
   Path A → B → C sequencing in §3. The tension of "they want it all now" is gone — they said the
   opposite. **Biggest unblock in the message.**
2. **"Postman vs brain" is a genuinely good architectural instinct — and it settles the engine debate
   on principle.** If we are *not* using Omnisend's automations, segments and flows, then Omnisend's
   **per-contact** billing is paying for a brain we've just decided not to use. A postman should bill
   **per message sent**, not per contact stored. ⚠ **This quietly contradicts this morning's "Omnisend
   stays" decision** — Omnisend is now paying for capabilities the client has explicitly said should
   live in our AI instead. Worth re-opening (see fork G).
3. **It explains *why* the `ctwa_clid` work matters.** It isn't just ad reporting — it's the first edge
   of the identity graph. What shipped today is literally stage 1 of what they described.
4. **"Separate powerful AI agent"** confirms the scenario engine is a real component with its own
   state, not prompt tweaks. Settles fork A toward (ii) — eventually.

### ❌ Three assumptions that don't survive contact with the APIs (researched 16 Jul)

| Client's assumption | Reality | Consequence |
| --- | --- | --- |
| **"Send via Shopify Email; Shopify is the delivery mechanism"** | **No general send API.** Shopify Email is now **Shopify Messaging** (automations move there 24 Mar 2026). Apps can only *trigger* narrow marketing automations (e.g. the "Customer subscribed to email marketing" trigger). Flow's *Send marketing email* **cannot customise the recipient via variables**; *Send internal email* is for staff. Ironically, **Shopify itself sends via SendGrid**. | **"Our AI composes a personalised message → Shopify delivers it" is not supported.** The *principle* is right, the *product* isn't available. A real postman = transactional ESP with an API: **SES / Postmark / Resend / SendGrid**. |
| **"Deep GA integration from the start to get per-user behaviour"** | GA4's **Data API is aggregate-only**. Per-person requires the **BigQuery export** + a `user_id` we set ourselves. Laggy, heavy, and GA is a *reporting* tool, not a profile store. | GA is largely **the wrong tool** for this job. **Shopify Web Pixels** are the better source: first-party, same platform as the orders. Keep GA for marketing reporting, not for the profile. |
| **"AI sees what they browsed, which products they opened"** | **Shopify's 7 browse/cart events carry no customer identity at all** (`page_viewed`, `product_viewed`, `collection_viewed`, `search_submitted`, `product_added_to_cart`, `product_removed_from_cart`, `cart_viewed`). Identity appears **only** in the 6 checkout events — and **since 10 Dec 2025 Shopify redacts even those** (name/email/phone/address → `null`) unless the app holds **approved Protected Customer Data access**. | **Browse behaviour is anonymous by design.** Linking it to a person is *our* problem (identity stitching), and getting checkout PII at all needs **a Shopify approval we don't have**. This is the single hardest piece of the vision. |

### 🔑 The core problem this vision reduces to: identity resolution

Everything the client wants ("new lead or existing customer", "which ad", "what they browsed", "did
they buy") is one problem wearing six hats: **joining an anonymous browser to a known person.**

We already solve one edge of it — `ctwa_clid` links *an ad click* to *a WhatsApp identity*. The
remaining edges:

| Edge | Mechanism | Status |
| --- | --- | --- |
| ad click → WhatsApp identity | `ctwa_clid` on the first message | ✅ **shipped today** |
| WhatsApp/phone → Shopify customer | phone match | ✅ built |
| anonymous browser → Shopify customer | checkout, or login | 🟡 Shopify-side, PII **redacted without approval** |
| **anonymous browser → known contact** | **first-party id (Web Pixel `clientId` / our own cookie) stitched at an identifying moment** | ❌ **the hard core — needs verification + design** |
| WhatsApp click-through → browser session | signed token in the link we send | ❌ not built — **but cheap, and it's the cleanest stitch we control** |

> **Note the last row.** Because *we* send the WhatsApp links, we can put our own token in them. That
> makes "this browsing session is this WhatsApp contact" trivially knowable — no cookie matching, no
> Shopify approval. **It's the highest-leverage identity edge available to us, and it's small.**

⚠ **Verify before designing:** whether the Web Pixel event payload exposes a stable `clientId` we can
correlate across browse → checkout. Two sources implied yes, neither confirmed. **This single fact
determines whether anonymous-behaviour stitching is cheap or near-impossible.**

### ⚖️ Privacy — not a footnote

"Use cookies and all available data" has legal limits. Building behavioural profiles of identifiable
people needs a lawful basis and a consent mechanism (Australian Privacy Act; GDPR if EU traffic).
Shopify's redaction change (Dec 2025) is the platform enforcing exactly this. **A cookie-consent
banner + a documented basis is a prerequisite for the behavioural layer, not a later polish item.**

---

## 2. The pipeline, stage by stage

```
  ┌─────────┐   ┌─────────┐   ┌──────────┐   ┌──────────┐   ┌─────────┐   ┌────────┐
  │ ACQUIRE │──▶│ CAPTURE │──▶│ QUALIFY  │──▶│ CONVINCE │──▶│ CONVERT │──▶│ MEASURE│
  └─────────┘   └─────────┘   └──────────┘   └──────────┘   └─────────┘   └────────┘
   Meta ad       ctwa_clid     scenario /     assets:        checkout /    CAPI back
   CTWA click    contact       questions      video, PDF     draft order   to Meta
   product CTA   consent       lead score     product links  payment link  revenue attr
      ❌            ✅             ❌              ❌             🟡            ❌
                                                                     └─ RETAIN: Omnisend email ✅ / WhatsApp re-engage 🟡
```

### Stage 1 — ACQUIRE ⚠️ **ADS ALREADY BUILT — just switched OFF (found 2026-07-16)**
- **Have:** production WhatsApp sender, verified business account (07-15), 4 approved templates. Meta
  Pixel confirmed live (see §1a).
- **⚠ The Click-to-WhatsApp campaign is already fully built by Daniel and simply disabled:**
  - Ad account `11731673` → campaign **"Lead Campaign - May 2026 (Sales Whatsapp)"**, objective
    *Messaging conversations*.
  - 2 ad sets: **"Paint Business Owner"**, **"DIY Painters"** (both toggled on).
  - 4 ads with creative: **Backpack Static ×2, Backpack Video ×2**.
  - **Spent $0.00 — never turned on.** So Stage 1 is *flip it on + confirm the click destination is
    WhatsApp*, **not build**.
  - (Wider account: 92 campaigns, ~$1,584 lifetime; "Sales Campaign - Dan Backpack - May 2026" is the
    only Active one — 139k impressions, 29 web purchases, ~$53/purchase, flagged "Low results".)
- **For Daniel to launch:** (1) switch the WhatsApp campaign On + set a test daily budget; (2) confirm
  each ad's button goes to **WhatsApp** (not Messenger/IG); (3) confirm the WhatsApp number is the one
  wired to our system; (4) two pending Ads-Manager dialogs are **his to action** — a Non-discrimination
  Policy acceptance (a legal agreement — not ours to click) and a financial-services-ads verification
  notice (likely irrelevant to paint).
- **Open:** dedicated ads number vs shared support number (mixing ad + support traffic affects number
  reputation + reporting clarity); Meta messaging volume tier.
- **Also possible:** Click-to-WhatsApp buttons on product pages (❌), Click-to-Instagram-Direct,
  Click-to-Messenger.

### Stage 2 — CAPTURE ✅ **DONE 2026-07-16, live in prod**
- **Have:** `ReferralCtwaClid` + full referral captured on the ad-click message → stored as first-touch
  on the contact, as an `ad_referral` event (every touch), and on the message. Lead → Shopify customer.
  Per-channel consent + STOP/START.
- **Plus (new, 2026-07-16): our own storefront web pixel is LIVE.** Shopify custom pixel
  "PaintAccess AI" (`134021223`) → `api/pixel/collect` → `web_events`. Verified receiving real shopper
  browsing (page/collection/product views) from paintaccess.com.au. We are no longer the only party in
  the stack blind to the storefront.
- **Note:** referral data is **perishable** — Meta sends it once and never re-sends. Every future ad
  click is attributable; anything before today is permanently lost.
- **Identity stitching is LIVE (2026-07-16).** AI-reply storefront links carry a signed contact
  token (`lib/comms/link-token.js`); when tapped, the pixel attributes that browser AND back-fills its
  earlier anonymous events. So `web_events` is no longer anonymous-only — a customer who clicks a link
  we sent becomes a known, full browsing profile. The self-controlled identity edge from §7.3, done.
- **Gap:** consent is *recorded* but the marketing-consent gate is **not enforced** on sends
  (deliberately — see §4 fork E). Stitching only fires once a customer clicks a tagged link — browsers
  who never receive/click a WhatsApp link stay anonymous (expected; that edge needs cookie matching or
  checkout, which are the harder, approval-gated options).

### Stage 3 — QUALIFY ❌ — **the long pole**
- **Have:** one stateless AI agent + knowledge base + Shopify context. It answers well; it does not
  *drive* a funnel.
- **Need:** funnel stages, per-customer stage tracking, qualification criteria, lead score.
- **Blocked on the client** giving us the actual scenario: the questions, what qualifies a lead, which
  product path follows which answer, which asset at which step. **No amount of engineering substitutes
  for this content.**
- **Fork:** prompt-only vs explicit state machine — see §4 fork A.

### Stage 4 — CONVINCE ❌ (media) — **partly unblocked; needs 2 decisions, not the clips**

> **Clarification (2026-07-16):** Stage 4 is **not fully blocked**. It splits in two:
> - **The pipeline** (storage + registry + a send-media adapter) can be built **now** — it needs a
>   storage decision, not the clips. We can prove it end-to-end with one sample PDF/clip.
> - **The library** (20–50 clips) is client content and is genuinely blocked.
>
> **DECISION B — DECIDED 2026-07-16: Supabase Storage now, migrate to Cloudflare R2 at scale.**
> We already run Supabase for the whole spine; it gives public URLs (satisfies WhatsApp's `MediaUrl`
> need) with **no new vendor, no new bill, no new credentials**. Enough for the funnel: ~50 clips
> ≤16MB ≈ 800MB, and because Meta caches each upload ~30 days, Supabase serves each file ~monthly (not
> per customer) so egress ≈ 0. Shopify Files stays a no as source of truth (June plan — weak
> versioning/API control).
>
> **⚠ MUST MIGRATE TO CLOUDFLARE R2 AT SCALE — do not skip this.** The moment the *same* media library
> also serves the website / email / landing pages, every page view becomes a download billed at
> **$0.09/GB egress** on Supabase. R2 has **zero egress fees** and is the right home for a real
> cross-channel video library — this is exactly why the June plan chose it. **Trigger to migrate:** the
> library starts serving the storefront/email at volume, or Supabase egress cost becomes noticeable.
> **Cost of migrating is low by design:** the media-registry schema is identical either way — only the
> stored URL changes, so it's a re-upload + a URL rewrite, not a redesign. Build the registry now with
> that swap in mind (store the storage key, derive the URL).
>
> **Second decision: which assets at which step** — that one *is* downstream of the scenario (Stage 3),
> so it can't be settled before Daniel answers.
- **Have:** product links render as CTA cards. Text + links only.
- **Need:** send video / PDF / images. **Reverses the 2026-07-13 "attachments skipped" decision.**
- **Already designed (June, Plan #2):** canonical library in Cloudflare R2 + CDN, media registry
  (`asset_key`, `funnel_step`, `cdn_url`, `whatsapp_media_id`, expiry), `media_id` cache with
  auto-refresh (Meta's copies expire ~30d), native WhatsApp video (<16MB, H.264 Main/Baseline + AAC,
  faststart), CDN-link fallback. **The design exists; the build doesn't.**
- **Blocked on the client** producing 20–50 clips. **This is content production, not engineering** —
  and it is the second long pole.

### Stage 5 — CONVERT 🟡
- **Have:** draft order + payment link capability exists (`api/callback.js`) but is **disabled**
  (`ENABLE_AI_CALLBACK` unset) pending a consent/compliance decision.
- **Need:** AI-callable `create_draft_order` tool; checkout link over WhatsApp; optionally WhatsApp
  Catalogue product cards; interactive reply buttons / list messages for branching.

### Stage 6 — MEASURE 🟡 **(CAPI lead reporting built + wired 2026-07-16 — waiting on token)**

> **Built 2026-07-16 (feature C):** `lib/comms/meta-capi.js` fires a **LeadSubmitted** to Meta's
> Conversions API on every ad-sourced conversation (`action_source: business_messaging`,
> `messaging_channel: whatsapp`, `ctwa_clid` from the captured referral), wired into
> `api/whatsapp/inbound.js`. **`reportPurchase` is built but not wired** (needs an order→contact link,
> which follows the scenario). **The one config blocker:** `META_CAPI_ACCESS_TOKEN` — a Meta System
> User token with `whatsapp_business_manage_events`. Until set, the module NO-OPS (sends nothing), so
> it's safe in prod and starts working the moment the token lands. Dataset defaults to the live pixel
> `334352823575129`. **Getting that token is a Daniel/Meta setup step.**

The rest of Stage 6 (below) still applies.

### Stage 6 (original) — MEASURE ❌
- **Have:** message lifecycle events (received/sent/delivered/read/failed) + the new `ad_referral`
  event. Volume, delivery and response-time reporting are **already possible today**.
- **Need:** Meta **CAPI** events (`Lead`, `InitiateCheckout`, `Purchase` with `action_source:
  business_messaging`, `messaging_channel: whatsapp`) carrying the stored `ctwa_clid` — this is what
  lets Meta optimise on **real orders** rather than "conversations started". Plus revenue attribution
  and business events (lead qualified, checkout started, order placed).
- **Note:** without this, ad spend optimises against the wrong signal. It is the highest-leverage
  missing piece after the scenario itself.

### Stage 7 — RETAIN (parallel lane)
- **Omnisend ✅ (external):** email campaigns, abandoned cart, post-purchase, web push. Already paid,
  natively Shopify-synced. **Don't rebuild.**
- **WhatsApp re-engagement 🟡:** 2 approved MARKETING templates (`reengage_offer`, `quote_ready`).
  Sending exists; **broadcast to a segment doesn't**.
- **Retargeting audiences ❌:** Omnisend's ad-audience sync depth is unverified — likely we push
  audiences ourselves via the same CAPI feed.

---

## 3. Three coherent paths

Each builds on the previous. **They are not alternatives to choose between once — they're a sequence,
and the honest question is how far down it to commit now.**

### Path A — "Prove the loop" (smallest, ~days)
Capture (done) + **CAPI conversion loop** + funnel guidance in the **agent prompt only**. No state
machine, no media, no broadcast.
- **Gets you:** a working ad → WhatsApp → AI → order path, with Meta optimising on real sales.
- **Doesn't need:** the client's scenario document or a single video clip.
- **Why it's attractive:** it proves the economics before anyone invests in content. If CTWA doesn't
  convert for this business, you learn it in weeks for near-zero build.
- **Risk:** the AI's funnel behaviour is fuzzy and unmeasurable per-stage.

### Path B — "Real funnel" (recommended target, weeks)
Path A + **explicit scenario engine** (funnel stage on the thread, qualification, lead score) +
**media pipeline** (R2 + registry + media_id cache).
- **Gets you:** what the client actually described on 16 July.
- **Blocked on:** the client's scenario content **and** the 20–50 clips. Both are theirs, not ours.
- **Honest sequencing:** start A now; B's engineering can't start meaningfully until the scenario
  arrives anyway.

### Path C — "Multi-channel" (later)
Path B + **Instagram DM** + **Facebook Messenger** on the same spine and the same scenario engine.
- **Why it's cheap after B:** the spine, inbox, takeover, consent and scenario are all channel-agnostic.
  IG is largely a second adapter, not a second project.
- **Lead-time item:** Meta App Review gates both. **Costs nothing to start now** and turns into the
  critical path if left until needed.

---

## 4. Open forks (decide these, in this order)

| # | Fork | Options | Note / lean |
| --- | --- | --- | --- |
| **A** | **Scenario engine shape** | (i) prompt-only (fast, fuzzy, no per-stage analytics) · (ii) explicit state machine on the spine (`funnel_stage` + score, deterministic, measurable) | Client's wording ("заранее продуманный сценарий", "квалифицирует лид") implies **(ii)**. But **(i) is the right *first* step** — it's Path A, and it needs no scenario doc. |
| **B** | **Media storage** | Cloudflare R2 + CDN · AWS S3 + CloudFront · Shopify Files | June plan: **R2**, and explicitly **not** Shopify Files as source of truth. Decide only when clips exist. |
| **C** | **Bulk SMS lane** | Omnisend (Pro only) · Twilio | **Blocked on knowing the Omnisend plan.** If Standard → Twilio, decision made for us. |
| **D** | **Ads number** | Dedicated ads number · shared support number | Mixing ad traffic with support affects number reputation + muddies reporting. Lean **dedicated** if volume is expected. |
| **E** | **Consent enforcement** | Enforce in send path · enforce only on broadcast | **Audit rejected enforcing in the send path** — `quote_ready` is a MARKETING-category template an operator legitimately sends when a customer *asked* for a quote; gating on category would block it. **Enforce on the future broadcast path only.** |
| **F** | **Attribution depth** | Capture only (done) · + full CAPI loop | Capture alone answers "which ad". CAPI is what makes the **ad algorithm** improve. Lean **full** — it's Path A's whole point. |
| **G** | **The "postman"** *(new, 16 Jul)* | Shopify Email · Omnisend · SES/Postmark/Resend/SendGrid | **Shopify Email is out — no send API** (see §1b). If the client's "brain in our AI" principle holds, **Omnisend's per-contact billing buys a brain we won't use** → a per-message API sender is the rational choice. ⚠ Re-opens this morning's "Omnisend stays". Note Omnisend is already paid, so the honest options are *keep it as an overpriced postman* or *move to a cheap API sender*. **Client decision.** |
| **H** | **Behaviour source** *(new)* | Google Analytics · Shopify Web Pixels · both | GA4 per-person needs BigQuery export; it's a reporting tool, not a profile store. **Web Pixels are first-party and live on the same platform as the orders.** Lean **Web Pixels for the profile, GA for reporting**. |
| **I** | **Identity stitching** *(new — the hard core)* | Signed token in our own WhatsApp links · Web Pixel `clientId` correlation · Shopify PCD approval | **Start with the token** — we control the links, so it needs no approval and no cookie matching. `clientId` correlation needs verification first. PCD approval is a Shopify review process, so treat as lead time. |

---

## 5. Blockers & who owns them

**The 16 Jul vision message did NOT move either long pole.** The client described what the system
should *know*; the scenario blocker is what the bot should *say*. Those are different documents, and
only the second unblocks engineering.

### Unchanged blockers

| Blocker | Owner | Blocks |
| --- | --- | --- |
| **Scenario content** — questions, qualification criteria, product paths, asset per step | **Client** | Stage 3, Path B · **still the #1 blocker** |
| **20–50 video clips + PDFs** | **Client** | Stage 4, Path B |
| **Which Omnisend plan + contact count** | **Client/Daniel** | Forks C + G, cost picture |
| **Is Shopify Inbox switched on?** | **Client/Daniel** | Whether there's a live AI blind spot |
| ~~Meta Pixel on storefront?~~ | — | ✅ **RESOLVED 07-16 — it's live** (`334352823575129`). See §1a. |
| **Confirm the pixel's domain allowlist** (62 domains pending, incl. `247games.com` which isn't ours) | **Client/Daniel** | Data hygiene — needs a human to say which are genuinely ours |
| **CTWA ad + WABA link** | **Client** | Stage 1 — nothing flows until an ad runs |
| **Meta App Review** | **Us, but lead-time** | Path C (IG/Messenger) |
| **WhatsApp 41% failure rate** | **Us** | Any WhatsApp spend — investigate first |
| **Verify Meta free-entry-point (72h)** | **Us** | The ROI case |

### New blockers the vision introduces

| Blocker | Owner | Blocks |
| --- | --- | --- |
| **Postman decision** — Shopify Email can't do it; keep Omnisend or move to an API sender? | **Client** | Any AI-composed email |
| **Identity resolution design** — how an anonymous browser becomes a known person | **Us** | The entire behavioural half of the vision |
| **Verify Web Pixel `clientId`** is stable + exposed | **Us** | Whether browse-stitching is cheap or near-impossible |
| **Shopify Protected Customer Data approval** — checkout PII is redacted without it (since 10 Dec 2025) | **Us, but lead-time** | Reading customer identity from checkout events |
| **Cookie consent + lawful basis** (AU Privacy Act / GDPR) | **Client + us** | The behavioural layer — **prerequisite, not polish** |
| **GA4 property access** + BigQuery export decision | **Client/Daniel** | GA-sourced behaviour (if pursued at all) |
| **Google Ads account access** | **Client** | Google as an ad source (newly in scope) |
| **Web Pixel deployment** to the theme (separate repo) | **Us** | Any first-party behaviour capture |
| **Meta internal analytics access** | **Client** | Meta-side reporting |

---

## 6. Economics (as understood — verify before quoting)

- **Inbound conversation:** free. Service messages inside the 24h window cost nothing.
- **CTWA-initiated:** reportedly free for ~72h **including templates** — ⚠ unverified.
- **Initiating outside the window:** paid template (MARKETING category costs more than UTILITY; no
  volume discount on marketing).
- **Omnisend:** per contact stored, not per send. Email is "free" at the margin — the cost is list size.
- **Twilio:** per message. WhatsApp ≈ AUD $0.07–0.12/conversation (May figure, recheck).
- **Implication:** the funnel is cheapest when the **customer initiates** (i.e. ads → they message us)
  and expensive when **we chase** (templates). This favours CTWA over broadcast — and conveniently,
  CTWA is what the client wants, while broadcast is what isn't built.

---

## 7. What I'd do next (opinion — revised after the 16 Jul vision message)

1. **Investigate the 41% WhatsApp failure rate.** Everything downstream sits on this channel. Purely
   ours, needs nobody's input.
2. **Start Path A** — the CAPI loop. Small, unblocked, makes the ads self-improving.
3. **Add the signed token to our own WhatsApp links** *(new — promoted by the vision message)*. Because
   we send those links, we can identify the browsing session with no cookie matching and no Shopify
   approval. It is **the cheapest identity edge available**, and it turns "AI sees what they browsed"
   from a platform fight into something we control. Small, unblocked, and it's the first real brick of
   the CDP the client described.
4. **Verify the Web Pixel `clientId`** — one afternoon, and it decides whether the whole
   anonymous-behaviour half is cheap or near-impossible. Do it before promising anything behavioural.
5. **Chase the scenario doc and the clips** — still the long poles; the vision message did not supply
   them.
6. **Start the lead-time approvals**: Meta App Review (IG/Messenger) and Shopify Protected Customer
   Data. Both are waiting, not building — start them before they're the critical path.
7. **Answer the cheap audits**: Omnisend plan, Shopify Inbox.
8. **Get a decision on the postman** (fork G) and put the cookie-consent basis in writing before any
   behavioural tracking ships.

**Still don't** build broadcast, segments, or a campaign UI. Omnisend covers email; WhatsApp broadcast
is the expensive way to message people who mostly haven't opted in (56 of 61 "not asked"). Grow consent
through conversations first.

**And don't start with Google Analytics**, despite "deep GA from day one" — it's aggregate-only, it's a
reporting tool rather than a profile store, and the first-party alternatives (our own link tokens,
Shopify Web Pixels) are both cheaper and more accurate. GA earns its place later, for reporting.
