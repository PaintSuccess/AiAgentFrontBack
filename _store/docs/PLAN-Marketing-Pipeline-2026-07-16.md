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
| **Klaviyo out, Omnisend stays** (client decision) | Engine question closed. Brevo / Listmonk+SES / Mailchimp all off the table. No new tool. |
| **Omnisend has no native WhatsApp** (only via 3rd-party Chatarmin) | WhatsApp — the priority channel — can *only* live in our system. Not a gap in our build; a permanent property of Omnisend. |
| **Omnisend SMS is Pro-plan only** (since 2026-05-04) | If the account is on Standard, **all** SMS runs through Twilio. Decides the bulk-SMS lane. **Need: which plan?** |
| **Omnisend bills per contact** (~$16/500, ~$132/10k) | Already sunk if subscribed, but caps list growth. Not worth expanding the email list aggressively. |
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

### Stage 1 — ACQUIRE ❌ (client/Meta side)
- **Have:** production WhatsApp sender, verified business account (07-15), 4 approved templates.
- **Need:** the actual Click-to-WhatsApp ad + WABA link in Meta Business Manager. **This is client-side
  setup, not code.**
- **Open:** dedicated ads number vs shared support number (mixing ad traffic with support affects
  number reputation + reporting clarity); Meta messaging volume tier; is the Meta Pixel on the
  storefront (flagged unverified since May, still unanswered).
- **Also possible:** Click-to-WhatsApp buttons on product pages (❌), Click-to-Instagram-Direct,
  Click-to-Messenger.

### Stage 2 — CAPTURE ✅ (done 2026-07-16, live in prod)
- **Have:** `ReferralCtwaClid` + full referral captured on the ad-click message → stored as first-touch
  on the contact, as an `ad_referral` event (every touch), and on the message. Lead → Shopify customer.
  Per-channel consent + STOP/START.
- **Note:** this data is **perishable** — Meta sends it once and never re-sends. Now that it's live,
  every future ad click is attributable; anything before today is permanently lost.
- **Gap:** consent is *recorded* but the marketing-consent gate is **not enforced** on sends
  (deliberately — see §4 fork E).

### Stage 3 — QUALIFY ❌ — **the long pole**
- **Have:** one stateless AI agent + knowledge base + Shopify context. It answers well; it does not
  *drive* a funnel.
- **Need:** funnel stages, per-customer stage tracking, qualification criteria, lead score.
- **Blocked on the client** giving us the actual scenario: the questions, what qualifies a lead, which
  product path follows which answer, which asset at which step. **No amount of engineering substitutes
  for this content.**
- **Fork:** prompt-only vs explicit state machine — see §4 fork A.

### Stage 4 — CONVINCE ❌ (media)
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

### Stage 6 — MEASURE ❌
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
- **Retargeting audiences ❌:** Omnisend's ad-audience sync is unverified and thinner than Klaviyo's
  (which we're removing) — likely we push audiences ourselves via the same CAPI feed.

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

---

## 5. Blockers & who owns them

| Blocker | Owner | Blocks |
| --- | --- | --- |
| **Scenario content** — questions, qualification criteria, product paths, asset per step | **Client** | Stage 3, Path B |
| **20–50 video clips + PDFs** | **Client** | Stage 4, Path B |
| **Which Omnisend plan + contact count** | **Client/Daniel** | Fork C, cost picture |
| **Klaviyo flow audit before uninstall** | **Client/Daniel** | Safe removal (it has live flows — a consent write triggered a real klaviyomail.com email on 07-14) |
| **Is Shopify Inbox switched on?** | **Client/Daniel** | Whether there's a live AI blind spot |
| **Meta Pixel on storefront?** | **Client/Daniel** | Any ad measurement |
| **CTWA ad + WABA link** | **Client** | Stage 1 — nothing flows until an ad runs |
| **Meta App Review** | **Us, but lead-time** | Path C (IG/Messenger) |
| **WhatsApp 41% failure rate** | **Us** | Any WhatsApp spend — investigate first |
| **Verify Meta free-entry-point (72h)** | **Us** | The ROI case |

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

## 7. What I'd do next (opinion)

1. **Investigate the 41% WhatsApp failure rate.** Everything downstream sits on this channel. It is
   also the only item here that is purely ours and needs nobody's input.
2. **Start Path A** — the CAPI loop. Small, unblocked, and it makes the ads self-improving.
3. **Chase the client for the scenario doc and the clips**, in parallel — they're the long poles and
   nothing in Path B starts without them.
4. **Start Meta App Review** for IG/Messenger — free to begin, pure lead time.
5. **Answer the cheap audits**: Omnisend plan, Klaviyo flows, Shopify Inbox, Meta Pixel.
6. **Verify the Meta free-entry-point** before any ROI conversation.

**Don't** build broadcast, segments, or a campaign UI. Omnisend covers email; WhatsApp broadcast is
the expensive way to message people who mostly haven't opted in yet (56 of 61 "not asked"). Grow
consent through conversations first.
