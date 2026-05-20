# Paint Access — Unified Communications Dashboard Plan

## Goal
A single page inside **Shopify Admin** showing all AI-driven communications in one place:
- Website chat conversations (ElevenLabs widget)
- Phone calls (ElevenLabs via Twilio)
- SMS messages (Twilio)
- WhatsApp messages (Twilio)
- Emails sent (Shopify draft orders via `send.js`)

---

## Architecture Overview

```
Shopify Admin → iframe page → Vercel Dashboard Pages
                                      ↓
                  ┌───────────────────┼───────────────┐
                  ↓                   ↓               ↓
            ElevenLabs API       Twilio API     Shopify API
            (conversations)     (SMS/calls)  (draft orders = emails)
```

The dashboard is a React app hosted on your **existing Vercel backend**.
Shopify Admin loads it inside an iframe — it looks native to Shopify admin.

---

## Data Sources — What's Available

### 1. ElevenLabs Conversations API (richest data)
- Full transcripts (every turn, role + message)
- AI analysis: `call_successful`, `transcript_summary`, `call_summary_title`
- Customer identification: `customer_name`, `customer_email`, `customer_id` (from dynamic_variables)
- Metadata: duration, cost, start_time, termination_reason
- Source type: widget / phone / sms / whatsapp
- Cursor-based pagination, up to 100 per page
- Filtering: date range, success, duration, full-text search, tool names used, language
- Smart search + text search endpoints

### 2. Twilio API
- Call logs: from/to, duration, status, recording URL
- Message logs: from/to, body, status, direction (inbound/outbound)
- Filterable by date, number, status

### 3. Shopify Draft Orders (emails sent)
- Every email sent via `api/email/send.js` creates a draft order
- Query via Shopify Admin API: recipient email, subject, status, timestamps

---

## Complexity Assessment

| Component | Difficulty | Notes |
|---|---|---|
| Shopify App setup | Medium | Need app registration (private app is fine, NOT store listing) |
| Dashboard frontend (Polaris UI) | Medium | React tables, filters, modals |
| ElevenLabs data proxy API | Easy | Rich API, just proxy and format |
| Twilio data proxy API | Easy | Standard REST |
| Email logs from Shopify | Easy | Query draft orders |
| Unified search | Medium | Fan-out queries to all 3 APIs |
| Real-time updates | Hard | Would need webhooks or polling — skip for now |

**Overall: MEDIUM difficulty, very feasible. Biggest effort is the frontend UI.**

---

## Phased Implementation Roadmap

### Phase 1 — Foundation (1–2 days)
- [ ] Register app properly with Shopify (private/custom app — NOT app store listing)
- [ ] Set up React frontend with Shopify App Bridge + Polaris component library
- [ ] Create 3 new Vercel proxy API endpoints:
  - `GET /api/dashboard/conversations` — ElevenLabs conversations list
  - `GET /api/dashboard/messages` — Twilio SMS/call logs
  - `GET /api/dashboard/emails` — Shopify draft orders (email records)
- [ ] Add navigation link in Shopify Admin sidebar pointing to dashboard

### Phase 2 — Main Dashboard UI (2–3 days)
- [ ] **Unified Timeline View** — all communications in chronological order
  - Columns: timestamp, type (chat/call/SMS/email/WhatsApp), customer, summary, status
  - Color-coded by channel
  - Filters: date range, channel type, customer email, success status
- [ ] **Detail Modal** — click any row to expand:
  - Full chat/call transcript
  - SMS/email message body
  - ElevenLabs AI summary + success evaluation
  - Link to customer profile in Shopify Admin

### Phase 3 — Analytics & Search (1–2 days)
- [ ] Stats cards: total conversations today/week/month, success rate, avg duration, cost
- [ ] Unified search across all channels
- [ ] Customer view: all communications for one customer by email

### Phase 4 — Enhancements (optional later)
- [ ] Export to CSV
- [ ] Webhook-based real-time updates
- [ ] Admin UI Extension: embed communications block on Shopify Customer detail page
- [ ] Alerts for failed conversations

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React + Shopify Polaris + App Bridge |
| Hosting | Existing Vercel project (`/dashboard` route) |
| Auth | Shopify session token via App Bridge (proves request comes from admin) |
| Data APIs | New `/api/dashboard/*` endpoints on Vercel |
| State/caching | React Query (pagination + caching) |

---

## What We Already Have

- ✅ Vercel backend with all credentials configured (ElevenLabs, Twilio, Shopify)
- ✅ ElevenLabs agent passing `customer_name`, `customer_email`, `customer_id`
- ✅ Twilio SMS/WhatsApp webhooks with auth token verification
- ✅ Shopify OAuth callback endpoint (`api/shopify/oauth-callback.js`)
- ✅ Shopify App Client ID + Secret already in Vercel environment
- ✅ ElevenLabs conversations API tested and returning rich data with transcripts

---

## Credentials Reference

| Service | Key |
|---|---|
| ElevenLabs Agent ID | `agent_1001kn99pk1xefprh4gb665f6j3p` |
| Shopify Store | `zgmzge-0d.myshopify.com` |
| Vercel Backend | `ai-agent-front-back-eta.vercel.app` |
| GitHub Repo | `https://github.com/PaintSuccess/AiAgentFrontBack` |
