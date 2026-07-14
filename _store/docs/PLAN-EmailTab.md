# Email tab — decided direction (build later)

_2026-07-14. Direction agreed; build deferred until the Google Workspace backend
is authorized. Postponed at the user's request to focus on bug fixes._

## Decisions (locked)
- **Scope:** 1:1 **conversational** email only — inbound customer emails + outbound
  replies, threaded per contact like the SMS/WhatsApp/Chat/Voice tabs. Marketing /
  bulk email is a **separate** module (Brevo/Listmonk, still deferred), NOT this tab.
- **Service:** the existing **Google Workspace / Gmail** mailbox already wired into
  the backend (`lib/google-workspace.js` + MCP `gmail_*` tools). No new ESP.
- **AI role:** **AI drafts, a human sends.** On an inbound email the AI prepares a
  suggested reply; a person reviews and sends. (Looser auto-send can come later.)

## ⚠ Blocker — Gmail backend not authorized
Production has **no `GOOGLE_*` env vars**, so `lib/google-workspace.js` throws
`google_config_missing`. This also means the ChatGPT agent's `gmail_*` tools are
currently non-functional in prod. Before building the Email tab, set up:
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`,
  `GOOGLE_WORKSPACE_EMAIL` in Vercel.
- The refresh token comes from a one-time OAuth consent — run the repo flow
  `api/google/oauth-start.js` → `api/google/oauth-callback.js` (requires the
  user's Google Workspace login; Claude cannot do this step).

## Build plan (when unblocked)
1. **Inbound ingestion** — a poll endpoint (`/api/comms/email-sync`, cron every few
   min via `vercel.json`) using `gmailSearchMessages`/`gmailGetMessage` to fetch new
   mail, resolve the contact by sender email, and `recordInbound({ channel: "email",
   externalProvider: "gmail", externalId: <gmail msg id> })` — idempotent by msg id.
   Store subject + Gmail `threadId` in message metadata for reply threading.
2. **AI draft** — on a new inbound email, generate a suggested reply (reuse the text
   agent with `channel: "email"`), store it as a draft on the message/thread (not
   sent). Surface it pre-filled in the composer with a "review before sending" note.
3. **Outbound send** — `lib/comms/email.js` wrapping `gmailSendEmail` (needs
   subject, To, body, In-Reply-To/threadId), `recordOutbound({ channel: "email" })`.
   New endpoint `POST /api/comms/email-send`.
4. **UI** — email messages render with subject + body; composer gains a subject
   field and sends via email when the channel is email (recipient = contact.email);
   AI-draft prefill.
5. Reuse the same **AI-control gate + human-takeover** model as the other channels.

Everything else (contacts/threads/messages spine, inbox UI, channel tabs) already
supports `channel: "email"` — this is additive.
