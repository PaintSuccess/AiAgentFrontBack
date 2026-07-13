# Inbox Feature Plan — toward the "Communication Hub" reference

_Created 2026-07-13. Gap analysis of our inbox vs. the reference design (Shopify
Brain Communication Hub), and a prioritized build order. Out of scope per the
client: monetization (usage meters / upgrade), notifications._

## 1. What the reference has (feature inventory)

**Navigation & shell**
- Compact left icon rail (logo + section icons)
- Top channel tabs: WhatsApp · SMS · Email · ChatGPT · Contacts · Automations · Analytics · Settings
- Bottom utility tabs: Inbox · Automations · Quick replies · Templates · Contacts · Labels · Team activity · Settings

**Conversation folders / filters (left sidebar)**
- Inbox · Starred · Pinned · Mentions · Unassigned · My Chats · Team · All Chats · Closed · Spam (each with a count)
- Per-channel folders with unread counts (WhatsApp / SMS / Email / ChatGPT)
- Status filter tabs: All · Open · Pending · Closed

**Conversation list**
- Photo avatars, name, last-message preview, time, unread badge, per-channel icon, delivery ticks
- Search + advanced filter control
- "New message" (start a new outbound conversation)

**Conversation view**
- Header: avatar, name, channel badge, phone, location, Star, Tag, More (…), Status dropdown (Open/Pending/Closed)
- Message bubbles with timestamps + read receipts
- Rich message cards / CTAs (e.g. "View catalogue")
- System/event messages ("You updated the message timer…")
- Composer: emoji · attachment · quick action · templates ({}) · text · Send (with send-options dropdown)

**Contact panel (right)**
- Edit contact; avatar, name, Lead/Customer badge, phone, email, location, local time
- Tags (add/remove)
- Notes (internal, add/edit)
- Recent orders (Shopify) + "View all"
- Customer history: first contact · messages sent · avg response time · last seen

**Larger modules** (own tabs): Automations, Analytics, Contacts directory, Templates, Quick replies, Labels, Broadcasts, Team activity.

## 2. What we already have

| Capability | Status |
| --- | --- |
| 3-pane layout (list / thread / contact) | ✅ |
| Channel filter tabs (All + per channel) | ✅ |
| Avatars (colored initials), unread badges, channel dots | ✅ |
| Search, All/Unread filter | ✅ (basic) |
| Bubbles, day dividers, delivery ticks | ✅ |
| Take over / hand to AI, outbound call | ✅ (ours; not in ref) |
| Contact panel: phone/email, tags, recent Shopify orders, history | ✅ |
| Human send (SMS/WhatsApp) | ✅ |

## 3. Prioritized build order

### P0 — Layout & space ✅ DONE
- [x] Compact icon rail (App.jsx + app-shell.css)
- [x] Full-bleed inbox filling width/height

### P1 — Quick wins ✅ DONE (except media — see open question)
- [x] **Status** control (Open/Pending/Closed) + folder filters
- [x] **Star / Pin** (threads.starred/pinned; folders + toggles; pinned sort first)
- [x] **Per-channel unread counts** on channel tabs (/api/comms/stats)
- [x] **Internal notes** on a contact (contacts.notes, synced to Shopify customer note)
- [x] **Edit contact** (name/email) + **tags** add/remove — all written back to the Shopify customer
- [x] **"View all orders"** + per-order deep-links to Shopify admin
- [x] **Quick replies / canned responses** (canned_responses table + composer popover + create)
- [x] **New message** composer (modal → send to a new number → opens the thread)
- [ ] **Attachments / media** — OPEN QUESTION (needs a storage/proxy approach decision, see §5)

### P2 — Medium ✅ DONE
- [x] **Assignment**: assign-to-me / unassign + Mine / Unassigned folders (uses the Shopify
      session user id). _Limitation: a full staff-member dropdown needs a staff directory —
      Shopify's staff API is Plus-only, so multi-staff assignment is deferred._
- [x] **Labels** (threads.labels[]; add/remove per thread)
- [x] **Contacts directory** tab (ContactsPage + /api/comms/contacts; click → opens thread)
- [x] **Pending** status (covers snooze's middle state; snoozed_until column exists for a
      timed-snooze UI later)
- [x] **Rich CTA cards** — product links render as "View product" buttons
- [x] **Server-side search** across contacts + message bodies (all history)

## 5. Open question — attachments / media
Both directions need an infra decision:
- **Inbound** (customer sends a photo): Twilio media URLs require Basic-auth to fetch, so the
  browser can't load them directly. Options: (a) an auth'd proxy endpoint the frontend blob-fetches,
  (b) copy media into a public store on receipt.
- **Outbound** (agent attaches a file): Twilio needs a publicly reachable MediaUrl, which means
  hosting the file (e.g. a **Supabase Storage** public bucket) — a privacy/retention/cost decision.

Proposed default: a Supabase Storage bucket for both (copy inbound on receipt, upload outbound),
with signed URLs. Pending the user's OK on hosting customer media there.

### P3 — Larger modules (own tabs; align with later phases)
- [ ] **Analytics** tab: volumes by channel, response times, AI-vs-human, delivery rates (reads `events`).
- [ ] **Automations** tab: rule builder (e.g. auto-tag, auto-assign, keyword routing).
- [ ] **Templates** manager (CRUD for WhatsApp/email templates).
- [ ] **Broadcasts** (marketing send to a segment — overlaps the deferred Brevo/marketing phase).

### Out of scope (per client)
- Monetization (usage meters, upgrade), notification center.
- Team activity is only meaningful once there are multiple staff seats.

## 4. Notes / dependencies
- Star/pin/notes/labels/assignment are all small `threads`/`contacts` schema additions + endpoints — cheap, do in P1/P2 batches.
- Media, quick replies, and new-message use the existing send service (`lib/comms/send.js`).
- Analytics/Automations are the only genuinely large builds; everything else is incremental on the current spine.
