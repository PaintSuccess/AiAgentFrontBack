# Plan — On-screen orders + working handoff, across all channels

_2026-07-15. Audit + fix plan after live widget voice tests (conv_6201, conv_9101).
Supersedes the quick patches; this covers every channel and the dependent UI._

> **STATUS: backend + agent LIVE 2026-07-15. Widget theme deploy PENDING.**
> Deployed: backend (order card payload + URL-free spoken message + handoff payload)
> and the live agent (client tools `display_order_in_chat` tool_3701kxj3bhrmeze82be4bybxf7h8
> + `open_whatsapp_handoff` tool_3701kxj3bjb7eq1bwr3hhzf5xy36; prompt point 4 rewritten;
> escalate tool description updated). **Not yet done:** deploy the updated widget snippet
> to the live Shopify theme (`npm run deploy-theme`, needs Chrome on :9222 + Shopify login)
> — until then the on-screen order card / WhatsApp button won't render even though the
> agent + backend are ready. Then re-test every channel.

---

## What the latest test proved (conv_6201, widget voice)

The earlier identity/400 fixes **worked**: `lookup_order` passed `customer_id` and
**found order #44542**; `escalate_to_human` returned `ok:true` with a link (no 400).
But two design gaps remain — both are the same root cause: **the widget can only put
things on screen through a client tool or the WebSocket safety-net; a webhook tool's
text/JSON result is only ever *spoken*, never *shown*.**

1. **Order read aloud, tracking URL spoken.** The agent said _"track it using this link:
   https://example.com/…"_ — reading a URL by voice. Products already render as on-screen
   cards (via `display_products_in_chat` + a WS safety-net); **orders have no equivalent**,
   so the agent just narrates them, URL and all.
2. **"I showed the WhatsApp on your screen" — but nothing appeared.** `escalate_to_human`
   is a **webhook** tool. Its `{message, link}` result is not rendered anywhere; the agent
   spoke a line claiming an on-screen link that doesn't exist. There is **no client-side
   render for the handoff**, on any widget channel (voice or text).

---

## How the on-screen mechanism actually works (from the widget source)

`_store/theme/snippets/ai-support-widget.liquid`:
- `clientTools = { display_products_in_chat, end_conversation }` — registered onto the
  ElevenLabs widget via `event.detail.config.clientTools` on the `elevenlabs-convai:call`
  event. When the agent calls one, the browser handler runs.
- `display_products_in_chat` → `showResults(payload)` → renders a floating overlay
  (`.pa-sw-results`) of cards; each card is an `<a target="_blank">` (a real user tap =
  reliable navigation).
- **WebSocket safety-net** (`installProductAutoDisplayWatcher`): wraps `window.WebSocket`,
  scans every ElevenLabs message for a `.products` array, and renders it **even if the LLM
  never calls the client tool**. This is the robust path — the agent skipped the client
  tool in conv_6201, but a safety-net would still have shown the card.
- The widget knows its context via dynamic variables: `conversation_mode` (`voice|chat`),
  `ui_surface: website_widget`, `display_products_available: true`.

**Design principle we'll reuse:** every "show on screen" feature needs BOTH (a) a client
tool the agent *can* call, and (b) a WS safety-net that fires off the **webhook result**
regardless of the LLM. The safety-net is what makes it reliable.

`order_status_url` (confirmed live on #44542) is the correct customer order link —
`https://www.paintaccess.com.au/<id>/orders/<token>/authenticate?key=…` — secure and
customer-facing. Use it as the primary order link; tracking URL is secondary.

---

## The channel matrix (target behaviour)

| Channel | Has screen? | Has phone? | Order result | Human handoff |
|---|---|---|---|---|
| **Widget – voice** | ✅ | ❌ | Show **order card** (client tool + WS net); speak a SHORT summary, **never read a URL aloud** | Show **"Chat on WhatsApp" button** (+ attempt auto-open); say "tap the button on your screen" |
| **Widget – text chat** | ✅ | ❌ | Show order card | Show WhatsApp button (+ attempt auto-open) |
| **Phone voice (Twilio)** | ❌ | ✅ | Speak summary; **SMS the order link** (`send_sms_notification`) | **SMS the wa.me link** (already works) |
| **SMS** | ❌ | ✅ | Text summary **ending with `order_status_url`** | Text the wa.me link (already works) |
| **WhatsApp** | ❌ | ✅ | Text summary ending with `order_status_url` | Text the wa.me link (already works; note it hands off to a *different* WhatsApp number) |

Rule the agent must follow: **on the website widget, NEVER speak a URL — put it on
screen. On text channels, always include the correct link in the text.**

---

## Changes, file by file

### 1. Backend — order lookup returns display payload + correct link
- `lib/customer-order-lookup.js`
  - `safeOrderSummary`: add `order_status_url: order.order_status_url || null` and a primary
    `tracking_url` convenience field.
  - New `displayOrderPayload(order)` → `{ order_number, date, status, total, items[],
    order_url, tracking_url }` shaped for the widget card.
- `api/shopify/order.js` — on `found`, add (mirroring `products.js`):
  - `next_action_required`: "If in the website widget, your next tool call MUST be
    `display_order_in_chat` using `display_order_in_chat_payload`, before speaking. Do NOT
    read any URL aloud. If SMS/WhatsApp, don't call it — end your text reply with the
    order link instead."
  - `display_order_in_chat_payload: displayOrderPayload(order)`.
  - Keep `message` (spoken/text summary) but strip the raw tracking URL out of the spoken
    summary for widget; `formatOrderReply` keeps the link for text channels.

### 2. Widget — two new client tools + renderers + safety-nets
`_store/theme/snippets/ai-support-widget.liquid`:
- `clientTools.display_order_in_chat(payload)` → `showOrder(payload)`: renders an **order
  card** (order #, date, status badges for payment/fulfilment, item list, total, and two
  buttons: **"View order"** → `order_url`, **"Track"** → `tracking_url` when present).
- `clientTools.open_whatsapp_handoff(payload)` → `showHandoff(payload)`: renders a
  prominent **"Chat with our team on WhatsApp"** button (`href=link target=_blank`) in the
  overlay, and **attempts `window.open(link)`** (see auto-open caveat below).
- Extend the **WS safety-net** to also scan webhook results for:
  - an **order shape** (`found:true` + `order_number`/`display_order_in_chat_payload`) →
    `showOrder`;
  - a **handoff shape** (a `link` matching `wa.me`) → `showHandoff`.
  This guarantees both render even when the LLM skips the client tool (as it did).
- Generalise the overlay (reuse `.pa-sw-results` with a heading swap, or a sibling panel).

### 3. Agent — register client tools + prompt rules
`_store/setup/` (new one-off script, in place / additive, no duplicate tools):
- Create client tools `display_order_in_chat` and `open_whatsapp_handoff` and attach to the
  agent (like `add-end-conversation-tool.js`).
- Prompt edits:
  - **lookup_order section**: "On the website widget, after a successful lookup you MUST
    call `display_order_in_chat` and must NOT read the order/tracking URL aloud — give a
    one-line spoken summary and say the details are on screen. On SMS/WhatsApp, end your
    reply with the order link."
  - **escalate_to_human**: "On the website widget you MUST call `open_whatsapp_handoff`
    with the returned link so it appears on screen; tell the customer to tap the button.
    Do not claim a link is on screen unless you called this tool."
- Update `escalate_to_human` webhook result to also include `display_handoff_payload:
  { link }` and a `next_action_required` mirroring the above.

### 4. Handoff lib — expose the payload
`lib/comms/handoff.js` / `api/comms/escalate.js`: include `display_handoff_payload:{link}`
and `next_action_required` in the response (no behaviour change to SMS/staff paths).

---

## Auto-redirect caveat (needs a decision)

True "auto-open WhatsApp" is **not reliable from a tool callback**: `window.open()` fired
from a WebSocket/tool handler is **not a user gesture**, so most browsers **block it as a
popup**. Options:
- **A (recommended):** render a big, auto-highlighted **"Open WhatsApp"** button (one tap =
  reliable) AND silently attempt `window.open`; if the browser allows it, great, if not the
  button is right there. Honest + robust.
- **B:** button only, no auto-attempt.
- **C:** insist on forced auto-open — not recommended; will be inconsistently popup-blocked
  and looks broken.

---

## Test plan (after build) — every channel
1. Widget voice: "track order 44542" → order card appears, no URL spoken. "connect me to a
   human" → WhatsApp button appears (+ auto-open attempt).
2. Widget text chat: same two.
3. SMS to the business number: order reply ends with the order link; "human" → wa.me link.
4. WhatsApp: same as SMS.
5. Phone call (if feasible to test): order link SMS'd; "human" → wa.me link SMS'd.
