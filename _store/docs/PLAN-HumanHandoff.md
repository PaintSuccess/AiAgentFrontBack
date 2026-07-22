# Plan — "Connect me to a human" across all channels

_2026-07-14. Cross-channel human escalation: when a customer on any AI channel
(voice call, WhatsApp, SMS, chat widget) asks for a human/team, hand them off to
Daniel (+ a manager) correctly — never by transferring a phone call._

> **STATUS 2026-07-22: Option 3 (relay handoff) designed and being built — see the
> "Option 3" section at the bottom.** Option 2 (Meta Groups API) was investigated in
> depth 2026-07-22 and is **blocked**: it requires an Official Business Account =
> the GREEN TICK (Meta "notability", 3–5 organic press articles) — the 2026-07-15
> "OBA confirmed" note below conflated business-portfolio verification with OBA and
> is wrong. Also: groups are invite-only (NO silent add of any participant, customer
> or staff — one-tap `chat.whatsapp.com` link is the best possible), Twilio does not
> expose the Groups API (its "group messaging" is a Conversations-API virtual relay),
> and native groups would need a number registered directly on Meta Cloud API.
> Option 3 delivers the actual goals (Daniel + Cris both in the loop from their own
> phones, everything logged in the hub, works on every channel) with none of those
> gates.
>
> **STATUS: Option 1 (deep-link) LIVE 2026-07-15, patched same day after first
> live test.** Code deployed to production, env vars set on Vercel, `escalate_to_human`
> registered on the live ElevenLabs agent (tool_0501kxhyyx8yfjx9ssx65j71w8cf, alongside
> the existing 8 tools). Option 2 (auto WhatsApp group) remains documented below as a
> future upgrade, not built.
>
> **2026-07-15 — first live test (website widget, voice) found & fixed two bugs:**
> (1) **escalate_to_human returned HTTP 400** on a website-widget voice chat, because
> the handoff required a phone number for channel "voice" — but widget voice is WebRTC
> with NO phone number (it has a screen instead). Fixed: never require a phone; only
> SMS the link on a real phone call (voice + has caller number), otherwise return the
> link in the message for on-screen display. Added customer_email passthrough so staff
> can identify no-phone (widget) customers. (2) **lookup_order failed for a logged-in
> customer** (customer_id 8654449573991, order #44542) — the agent never passed
> customer_id and instead chased the customer's *spoken* email, which voice
> transcription mangled (gluked→"glookit"→"gluket"), so nothing matched. Backend was
> fine; root cause was the agent prompt weakly saying "you may pass customer_id".
> Fixed agent-side (`_store/setup/fix-handoff-and-orderlookup.js`): prompt now says
> MUST pass customer_id, never rely on a spoken email; escalate tool description/schema
> refreshed in place. Still not done: a clean end-to-end re-test through the live agent.
>
> **2026-07-15 update — OBA confirmed.** Checked live in Meta Business Manager
> (business_id 1953771224878899): Business Portfolio shows **"Verification successful"**
> for organisation verification — the core Option 2 prerequisite is met. Two related
> caveats found while checking: (1) the WhatsApp display name **"PaintAccess" was
> REJECTED** by Meta (violates Display Name Guidelines) — the `+1 555-974-0172` number
> is **Offline/Rejected** because of it; only `+61 485 077 888` ("Paint Access", High
> quality) is healthy. (2) Messaging tier is capped at **2,000 new conversations/day**
> (mid-tier, not unlimited). Neither blocks building Option 1. For Option 2, still
> unresolved: whether Twilio exposes the Groups API on this WABA, or whether it needs
> Meta Cloud API directly — and the rejected display name should be fixed before any
> customer-facing group flow goes on that number.
>
> **2026-07-15 — Option 1 built.** `lib/comms/handoff.js` (escalation logic),
> `api/comms/escalate.js` (ElevenLabs server-tool endpoint, Bearer `API_SECRET_TOKEN`
> auth), `_store/setup/add-escalate-to-human-tool.js` (one-off script to create +
> attach the `escalate_to_human` webhook tool to the live agent — not yet run).
> `HUMAN_SUPPORT_WA_NUMBER` and `HUMAN_SUPPORT_NOTIFY_NUMBERS` both set to Daniel's
> number `+61410609617` (env, not yet on Vercel production). Live-tested the
> staff-notify SMS path — it worked, but surfaced a real bug: **Daniel's SMS reply to
> the alert was answered by the customer-facing AI**, because inbound SMS/WhatsApp
> webhooks didn't distinguish staff numbers from customers. Fixed by adding
> `isStaffNumber()` to `handoff.js` and an early-exit guard in both
> `api/twilio/sms-inbound.js` and `api/whatsapp/inbound.js`: any inbound message from
> a number in `HUMAN_SUPPORT_NOTIFY_NUMBERS`/`HUMAN_SUPPORT_WA_NUMBER` now skips the
> AI and customer-thread pipeline entirely. Env vars set on Vercel
> production, deployed, and `_store/setup/add-escalate-to-human-tool.js` run against
> the live agent successfully. Still remaining: a real end-to-end test through the
> live agent (ask it to connect you to a human on voice, SMS, WhatsApp, and widget).

---

## The two handoff options

### Option 1 — Deep-link redirect to Daniel's WhatsApp (separate number)
The AI gives the customer a `wa.me/<Daniel's number>?text=<pre-filled context>` link.
The customer taps it → WhatsApp opens a 1:1 chat with Daniel's personal number → they
talk directly on Daniel's phone.

- **Feasibility:** trivial. No API, no verification, works today, every channel.
- **Cost:** free.
- **Multi-party (manager):** not automatic — Daniel would add the manager manually, or we
  notify the manager in parallel.
- **Logging:** ❌ the human conversation happens on Daniel's personal WhatsApp, OUTSIDE our
  system — not captured in the Comms Hub.

### Option 2 — Auto-created WhatsApp group (customer + Daniel + manager, no AI)
Our business number creates a per-customer WhatsApp group, adds Daniel + the manager +
the customer, and stays silent (we simply don't run the AI on group messages).

- **Feasibility (NEW in 2026):** Meta launched a **WhatsApp Groups API** — you *can* now
  create groups + message them programmatically ([Meta Groups API](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups),
  [2026 guide](https://www.wuseller.com/whatsapp-business-knowledge-hub/whatsapp-groups-api-create-manage-groups-2026-guide/)).
  Limits: **max 8 participants/group**, up to 10,000 groups per number, text/media/templates
  only (no interactive/disappearing messages), **no calling in groups**, per-message pricing.
- **Hard prerequisites (the catch):**
  1. **Official Business Account (OBA)** — the Groups API is only open to businesses with a
     *verified* OBA (green checkmark). **Does PaintAccess have this?** ← gating question.
  2. Likely **Meta Cloud API directly** — we currently send WhatsApp via **Twilio**; it's
     unclear Twilio exposes the Groups API. Option 2 probably needs a Meta Cloud API setup
     (repo has scaffolding: `WHATSAPP_PROVIDER=meta`, `META_WHATSAPP_*` env, but unused).
  3. **Participant opt-in** — adding Daniel/manager/customer to a group may require their
     acceptance (needs verification during build).
- **Multi-party (manager):** ✅ automatic.
- **Logging:** ✅ our number is in the group → we receive the messages → can log them in the
  Comms Hub (just don't run AI on them).

### Side-by-side
| | Option 1 (deep-link) | Option 2 (group) |
|---|---|---|
| Works today | ✅ instantly | ⚠️ needs OBA + likely Meta Cloud API |
| Manager auto in loop | ❌ (manual) | ✅ |
| Conversation logged in hub | ❌ | ✅ (our number hosts) |
| Cost | free | per-message |
| Complexity | trivial | significant (verification + migration + lifecycle) |
| Risk | none | ToS-clean but more moving parts; 8-person cap |

---

## The real work is the same for both: a cross-channel escalation engine

Regardless of which handoff we use, the valuable/hard part is **detecting the request and
routing it correctly on every channel** — that's channel-agnostic and reused by either option.

### Escalation engine
Add an **`escalate_to_human`** capability the AI can invoke wherever it runs:
- **Voice + SMS + WhatsApp + widget** all run on the **ElevenLabs agent** → add one
  ElevenLabs **server tool** (`escalate_to_human`) the agent calls when it detects intent
  ("talk to a person", "connect me to the team", "I need a human"). One tool covers every AI
  surface.
- Tool inputs: `{ channel, customer_phone, preferred_method: "whatsapp"|"sms", reason }`.
  The AI infers `preferred_method` from the conversation (e.g. customer says "I don't use
  WhatsApp" → sms).
- On trigger, the backend:
  1. **Pauses the AI** on that customer's thread (reuse the takeover model → control=human).
  2. **Runs the handoff strategy** (Option 1 or 2).
  3. **Notifies Daniel (+ manager)** by SMS with the customer + context (SMS = no 24h-window
     issue for internal alerts).
  4. **Logs a handoff event** in the Comms Hub thread (visible to staff).

### Channel-specific delivery
- **Text (SMS / WhatsApp / widget):** the AI's reply includes the handoff (the `wa.me`
  link for Option 1, or "you've been added to a group with our team" for Option 2).
- **Voice:** the AI can't open a link mid-call → we **SMS the customer** the handoff link,
  and the AI says "I've just texted you a link to reach our team." **Never transfer the
  call to a phone number** (per requirement).
- **Preference honoured:** if the customer isn't comfortable with WhatsApp → SMS route
  (Daniel reaches out by SMS / continues the SMS thread as a human via the hub). Never a call.

---

## Recommendation

**Build the escalation engine now with Option 1 (deep-link) as the default handoff** — it's
zero-dependency, works on every channel immediately, and delivers the core value. **Design the
handoff as a pluggable strategy** so Option 2 (group) can be dropped in later *if* PaintAccess
has (or gets) an OBA and accepts the Meta Cloud API path.

Rationale: Option 2 is genuinely better on multi-party + logging, but it's gated on business
verification + a WhatsApp-provider migration that could take a while and may not even be
available. Option 1 ships the whole cross-channel flow this week; Option 2 becomes an upgrade
to the same engine, not a rebuild.

## Implementation sketch (Phase 1 — Option 1)
- `lib/comms/handoff.js`: `escalateToHuman({ channel, phone, preferred, reason })` →
  pause AI (humanTakeover), build the `wa.me` link (env `HUMAN_SUPPORT_WA_NUMBER` = Daniel's
  number), deliver per channel (SMS the link on voice; return link text on chat/sms/wa),
  notify Daniel + manager by SMS (env `HUMAN_SUPPORT_NOTIFY_NUMBERS`), log a `handoff` event +
  a system message in the thread.
- `POST /api/comms/escalate` (server-tool endpoint, token-auth like the other ElevenLabs
  tools) → calls the lib.
- Register `escalate_to_human` as an ElevenLabs server tool on the agent (config, not code) +
  a one-line instruction in the agent prompt/KB so it knows when to call it and to prefer
  WhatsApp unless the customer objects, never a call.
- A small "Escalated to human" marker in the Comms Hub thread.

## Open questions
1. **Does PaintAccess have a verified Official Business Account (OBA)?** (Decides if Option 2
   is even possible.)
2. **Daniel's WhatsApp/support number** (the separate number) + **the manager's number(s)**.
3. **How should Daniel/manager be notified** — SMS alert (recommended) vs WhatsApp vs both?
4. Is it acceptable (Option 1) that the human conversation lives on Daniel's personal WhatsApp
   and isn't logged in the hub? (If not → that's a strong reason to pursue Option 2.)

## What to gather before building (checklist)
- [x] **OBA status** — confirmed 2026-07-15: Business Portfolio verification successful.
- [ ] **Daniel's WhatsApp/support number** (the separate human-handoff number).
- [ ] **Manager number(s)** to include/notify.
- [ ] **Notification channel** for alerting Daniel/manager on a new escalation (SMS recommended).
- [ ] **Logging preference** — is off-system (Daniel's phone) OK, or is in-hub logging required
      (pushes toward Option 2)?
Once these are in, the recommended first build is the escalation engine + Option 1 (est. small,
mostly one ElevenLabs server tool + `lib/comms/handoff.js` + an endpoint + agent-prompt line).

---

## Option 3 — Relay handoff (mirror the thread to staff phones) — DESIGN 2026-07-22

The customer never leaves the chat they're already in with the business number. Daniel +
Cris ("staff legs") each get the dialog mirrored to their own WhatsApp (SMS fallback) and
reply from their phones; replies route back to the customer via the business number. No
Meta Groups API, no green tick, no provider migration, no second number.

### Why relay beats the alternatives
| | Relay | Meta group | Twilio Conversations | Comms Hub only |
|---|---|---|---|---|
| Green tick / migration / new number | none | all three | none, but pipeline rebuild | none |
| Customer effort | zero | tap invite | zero | zero |
| Customer without WhatsApp | ✅ (SMS leg) | ❌ | ✅ | ✅ |
| Staff concurrent escalations | ✅ (quote/#tag) | ✅ | ❌ 1 active per staff pair | ✅ |
| Staff reply from own phone | ✅ | ✅ | ✅ | ❌ |
| Logged in hub | ✅ | ✅ | ✅ | ✅ |

### Flow
1. Customer asks for a human on any channel → `escalate_to_human` (unchanged trigger:
   deterministic regex on SMS/WA, agent tool on voice/widget).
2. `escalateToHuman()` with `HANDOFF_METHOD=relay`: resolves/creates the customer thread,
   opens a **relay session** (`handoff_relays` row, human-friendly `#tag`), pauses the AI,
   and alerts each staff leg (WhatsApp first, SMS fallback) with recent context + an
   **admin deep link** into the Comms Hub thread.
3. Every subsequent customer message on that thread: recorded as usual → AI stays silent →
   mirrored to staff legs (`#12 John: ...`). Mirrored-message SIDs are stored in
   `handoff_relay_mirrors` for quote-reply routing.
4. Staff reply to the business number → inbound webhook staff branch routes to the relay
   router instead of dropping: quoted `OriginalRepliedMessageSid` → exact relay; else
   `#tag` prefix; else single-active; else ambiguity prompt listing active relays.
   Routed text is sent to the customer via `sendMessage(author:"human")` (logged, refreshes
   takeover) and cross-mirrored to the other staff leg (`↪ Daniel: ...`).
5. `#done` (optionally `#done 12`) closes the relay: control back to AI, confirmation +
   admin transcript link to staff, system marker in the thread. Lazy auto-close after
   `RELAY_IDLE_HOURS` (default 48) of no activity.

### Per-channel customer experience (relay mode)
- **WhatsApp / SMS:** "Our team is here with you now — just keep replying in this chat."
  No link at all.
- **Phone call:** agent says the team will text; we SMS an opener from the business number
  ("Hi, it's the Paint Access team — reply here any time") which creates/keeps the thread.
- **Widget with phone/email:** same as phone (text them).
- **Widget without phone:** on-screen WhatsApp button now deep-links to the **business
  number** (not Daniel's personal) with pre-filled handoff text; when their first WhatsApp
  message arrives, the deterministic handoff regex escalates it → relay opens with their
  number. (In link mode the button still points at `HUMAN_SUPPORT_WA_NUMBER`.)

### Admin deep link (works in BOTH modes, ships first)
- `GET /api/comms/open?t=<threadId>` → 302 to `${ADMIN_DEEP_LINK_BASE}?page=inbox&thread=<id>`;
  vercel rewrite `/t/<id>` keeps it SMS-short. Auth burden is on Shopify admin login.
- `ADMIN_DEEP_LINK_BASE` env, e.g. `https://admin.shopify.com/store/zgmzge-0d/apps/<app-handle>`.
  Link omitted if unset.
- App boot: `App.jsx` reads `?thread=<id>` and opens the inbox on that thread via the
  existing `openInbox({threadId})` mechanism.
- Also added to Option 1's staff alert (`notifyStaff`) immediately.

### Guard rails
- **Feature flag:** `HANDOFF_METHOD` env — unset/`link` = Option 1 exactly as today;
  `relay` = Option 3. Deploy is a no-op until the env flips. Any relay-open failure falls
  back to Option 1 behavior (never fail an escalation).
- **AI silence:** while a relay is ACTIVE the inbound gate skips the AI for that thread
  regardless of the 30-min takeover window (relay is the source of truth); closing the
  relay hands control back to `ai`.
- **No staff-thread pollution:** staff mirrors are sent via the raw senders
  (`sendWhatsAppMessage`/`twilioSendSms`), NOT `sendMessage`, so no contact/thread rows are
  created for staff numbers. Customer-bound staff replies use `sendMessage` on purpose
  (they belong in the customer thread).
- **Media:** v1 mirrors a `📷 attachment` placeholder (Twilio inbound parser is text-only
  today); the admin link shows the real thing in the hub.
- **Staff WhatsApp 24h window:** WA mirror send failure → automatic SMS fallback for that
  message. One-time onboarding: Daniel + Cris each send one WhatsApp message to the
  business number.
- **Webhook-retry idempotency (added after code review):** `handoff_relay_mirrors` is
  also a message-SID ledger (`kind` = mirror | customer_inbound | staff_inbound). A
  Twilio redelivery completes an unfinished customer mirror instead of losing it, and can
  never double-send a staff reply to a customer (ledger row written BEFORE the send;
  lookup fails closed for staff_inbound).
- **Misroute protection for plain staff replies (added after code review):** an untagged,
  unquoted reply only auto-routes to the single active relay when that relay is also the
  last thing mirrored to that staff phone — otherwise it warns and asks for a quote/#tag.
  Every routed reply gets a "✓ Sent to #tag <name>" ack naming the recipient, so any
  residual misroute is visible immediately.
- **Zero staff reached** on open → the relay closes itself and the escalation falls back
  to the deep-link method (with the link FORCED to Daniel's number even in relay mode,
  so a failing relay can't loop the customer back into the same escalation).
- **SMS webhook signature check now fails closed** when TWILIO_AUTH_TOKEN is unset
  (matched to the WhatsApp webhook, which was hardened earlier) — a forged staff `From`
  must never reach the relay router.

### Files
| File | Change |
| --- | --- |
| `supabase/migrations/0008_handoff_relay.sql` | `handoff_relays` + `handoff_relay_mirrors` |
| `lib/comms/relay.js` | NEW — session lifecycle, mirroring, staff-reply routing (pure routing core, side-effect shell) |
| `lib/comms/handoff.js` | `method:"relay"` branch, admin link in alerts, relay-aware `buildWaLink` |
| `api/twilio/sms-inbound.js` | staff branch → relay router; customer branch → relay mirror hook |
| `api/whatsapp/inbound.js` | same, + pass `OriginalRepliedMessageSid` |
| `api/comms/open.js` | NEW — admin deep-link redirect |
| `vercel.json` | `/t/:id` rewrite |
| `src/App.jsx` | boot-time `?thread=` deep link |
| `scripts/test-handoff-relay.js` | offline tests (routing core, alert composition) |

### Env additions
`HANDOFF_METHOD` (unset=link), `ADMIN_DEEP_LINK_BASE`, `RELAY_IDLE_HOURS` (48).

### Rollout
1. Apply migration 0008 in Supabase. 2. Deploy (flag off — behavior unchanged, admin link
appears in Option 1 alerts). 3. Set `ADMIN_DEEP_LINK_BASE`, verify deep link. 4. Staff
onboarding messages to the business number. 5. Flip `HANDOFF_METHOD=relay`. 6. Live test
per channel (remember: every escalate pages Daniel for real). 7. Later: `#done` timing,
media forwarding, staff-initiated relay from the hub UI.

---

## Option C — website-widget phone capture ("offer both at once") — 2026-07-22

Anonymous website-chat visitors used to get only a "Chat on WhatsApp" button (bad on
desktop, and an app-switch on mobile). Option C offers **both at once**: the WhatsApp
button AND an inline "leave your mobile and we'll text you" field. Typing a mobile opens
the SMS relay directly (no app-switch, works on desktop). If we already know their mobile
(logged-in customer) we skip straight to texting. **Voice widget mode gets the button
only** — a typed/spoken number mid-call is unreliable (same failure class as the spoken-
order-number bug).

Chosen over "ask for the phone first, button on refusal" (a sequential gate) because the
ask lands at the worst moment — the customer just asked for a human. Offering both is the
same capture rate with no blocking step, and self-solves device differences.

### Flow
1. Widget escalation with no phone + relay on → `escalateToHuman` returns
   `open_whatsapp_handoff_payload` with `allow_phone_capture:true` + a signed `handoff_token`.
2. Widget (`ai-support-widget.liquid` `showHandoff`) renders the button + mobile field
   (unless voice mode). Submitting posts `{phone, token, reason}` to the callback.
3. `POST /api/comms/handoff-callback` (public) → `escalateToHuman({channel:"widget", phone})`
   → SMS relay opens, staff paged, opener SMS to the customer → "we'll text you now".

### Security (public endpoint that pages staff + sends SMS — defended in depth)
- **Signed token** (`mintHandoffToken`/`verifyHandoffToken`, HMAC-SHA256 over a 15-min
  expiry with `API_SECRET_TOKEN`): only a real escalation can mint one; strict `exp.sig`.
- **Single-use**: `checkRateLimit('handoff-tok:'+sig, 1, 900)` — a captured token can't be
  replayed for many numbers.
- **Per-phone cap**: `checkRateLimit('handoff-phone:'+phone, 2, 3600)` — the anti-SMS-bomb
  gate; one number is never texted more than twice an hour, whatever the IP or token count.
- **Per-IP cap**: `checkRateLimit('handoff-cb:'+ip, 4, 600)`.
- **AU-mobile only**: `normalizePhone` (AU-aware) then `/^\+614\d{8}$/`.
- Residual (accepted): a valid token + a real AU mobile can text that number a benign
  opener even if it isn't the submitter's; the caps make volume abuse impractical.

### Files
- `lib/comms/handoff.js` — token mint/verify/id; `allow_phone_capture` + token in the
  widget payload when relay on and no phone.
- `api/comms/handoff-callback.js` — NEW public endpoint.
- `../frontend/shopify/snippets/ai-support-widget.liquid` — `showHandoff` renders the
  field + `wireHandoffPhoneForm` (theme repo, deploy via Shopify CLI).
- `scripts/test-handoff-relay.js` — token + AU-mobile offline tests (50 total).

No new env: reuses `API_SECRET_TOKEN`. Requires `HANDOFF_METHOD=relay` (already live).
