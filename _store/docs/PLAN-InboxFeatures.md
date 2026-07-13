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

### P0 — Layout & space (doing now)
- [ ] Replace the wide Polaris text nav with a **compact icon rail** (logo + Inbox/KB, room for future sections).
- [ ] Make the inbox **fill the full width and height** (remove wasted empty space); polished empty state.

### P1 — Quick wins (fit our current data + schema)
- [ ] **Status filter tabs**: All · Open · Closed (thread.status already exists; add Pending). Wire the list filter + a status control in the thread header.
- [ ] **Star / Pin** a conversation (add `starred`, `pinned` bool columns to `threads`; folders + toggle).
- [ ] **Per-channel unread counts** on the channel tabs.
- [ ] **Internal notes** on a contact (add `contacts.notes` text or a `notes` table; show/edit in panel).
- [ ] **Contact "Edit"** (name/email) + **tag add/remove** (write to `contacts`).
- [ ] **"View all orders"** deep-link to the Shopify customer admin page.
- [ ] **Quick replies / canned responses** (a small `canned_responses` table; insert into composer). Includes approved **WhatsApp templates** for outside the 24h window.
- [ ] **New message** composer (start a conversation to a new number/customer).
- [ ] Attachment/media send + inbound media rendering (Twilio MediaUrl; store in `messages.media`).

### P2 — Medium
- [ ] **Assignment**: assign a thread to a staff member; Unassigned / My Chats / Team folders (needs a `staff`/`assigned_to` concept + who "me" is via the Shopify session).
- [ ] **Labels** (many-to-many thread labels beyond tags).
- [ ] **Contacts directory** tab (searchable list of all contacts + profiles).
- [ ] **Snooze / Pending** state + reopen.
- [ ] **Rich CTA cards** in messages (product/catalogue cards rendered from links).
- [ ] Server-side search across all history (not just the loaded page).

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
