# Plan — "Connect me to a human" across all channels

_2026-07-14. Cross-channel human escalation: when a customer on any AI channel
(voice call, WhatsApp, SMS, chat widget) asks for a human/team, hand them off to
Daniel (+ a manager) correctly — never by transferring a phone call._

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
