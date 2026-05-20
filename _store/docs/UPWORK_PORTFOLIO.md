# Upwork Portfolio Entry — Paint Access AI Support System

---

## Title

AI Customer Support System for Shopify — ElevenLabs · Twilio · Vercel

---

## Skills

- Chatbot Development
- Conversational AI
- ElevenLabs API
- Twilio API
- Shopify Theme Development
- Shopify Admin API
- Node.js
- REST API Development
- Vercel / Serverless Functions
- WhatsApp Business API

---

## Deliverables

1. ElevenLabs AI agent configured with domain-specific knowledge base (9 documents — product guides, paint estimation logic, sprayer troubleshooting, recommendation rules, FAQs)
2. Shopify Liquid widget snippet embedded in the live theme via Shopify CLI
3. Vercel serverless backend with 7 REST API endpoints
4. Shopify Admin API middleware — real-time product search, order lookup, and inventory checks
5. Twilio Voice — Australian phone number connected for live AI inbound voice calls
6. Twilio SMS & WhatsApp two-way AI messaging webhooks
7. Full deployment, integration testing, and go-live on paintaccess.com.au

---

## Short Description

Built a multi-channel AI customer support system for an Australian Shopify paint supplies store. One ElevenLabs AI agent handles website voice/chat, inbound phone calls, SMS, and WhatsApp — backed by a custom Node.js API on Vercel that connects to the Shopify Admin API for live order lookups, product searches, and inventory checks.

---

## Full Description

# Multi-Channel AI Support System for Shopify E-Commerce

## Overview

Designed and built a full-stack AI customer support system for **Paint Access** (paintaccess.com.au), an Australian B2B/B2C paint supplies and equipment retailer operating on Shopify. A single **ElevenLabs Conversational AI** agent handles real-time customer interactions across four channels — website chat/voice widget, inbound phone calls, SMS, and WhatsApp — all connected through a custom serverless backend.

---

## What Was Built

### AI Agent & Knowledge Base

- Configured an ElevenLabs Conversational AI agent with a **9-document domain knowledge base**: product guides, paint coverage estimation logic, sprayer troubleshooting, product recommendation rules, excluded product restrictions, and company FAQs
- Tuned bot behavior rules for tone, escalation handling, and upsell boundaries
- Attached **5 webhook tools** to the agent for live Shopify data access and email triggers

### Shopify Theme Integration

- Developed a custom **Liquid snippet** embedding the voice/chat widget into the live Shopify theme
- Deployed the theme update via **Shopify CLI** with zero downtime
- Widget positioned and styled to co-exist with the store's existing live chat button

### Backend API (Vercel Serverless)

- Built a **Node.js serverless API** on Vercel with 7 REST endpoints:
  - `/api/shopify/products` — product search by name or SKU
  - `/api/shopify/order` — order lookup by number or email
  - `/api/shopify/inventory` — real-time stock check by variant
  - `/api/twilio/sms-inbound` — inbound SMS routing
  - `/api/twilio/whatsapp-inbound` — inbound WhatsApp routing
  - `/api/email/send` — customer email notifications
- Centralized **Shopify Admin API auth** with a `cleanEnv()` helper to strip trailing whitespace from environment variables — resolving a silent 401 failure in production

### Twilio Multi-Channel Integration

- **Voice:** Australian Twilio number routed to ElevenLabs for live AI phone calls
- **SMS:** Inbound SMS webhook delivers natural-language AI replies
- **WhatsApp:** WhatsApp Business messaging service with full two-way AI conversation support

---

## Tech Stack

- **AI:** ElevenLabs Conversational AI — agent, voice, knowledge base, tools
- **Telephony:** Twilio Voice, SMS, WhatsApp Business API
- **Backend:** Node.js, Vercel Serverless Functions
- **E-commerce:** Shopify Admin API, Shopify Liquid, Shopify CLI
- **Infrastructure:** Vercel (free tier — 100K req/mo)

---

## Key Challenges Solved

- **Unified a single AI brain across four separate channels** — website, phone, SMS, and WhatsApp each have different protocols and data formats; designed the backend so all channels funnel through one ElevenLabs agent with consistent context and behavior
- **Built real-time e-commerce awareness into a conversational AI** — bridged the gap between a live Shopify store and a voice/chat agent so the AI can answer questions about actual stock levels, order status, and product availability rather than scripted responses
- **Zero-downtime Shopify theme deployment** — integrated the AI widget into a production store without breaking the existing storefront, live chat button, or any existing customer flows
- **Designed for cost-efficiency at scale** — entire backend runs on Vercel's free serverless tier; no always-on servers, no per-seat SaaS costs beyond the AI and telephony subscriptions already in place
- **Overcame Shopify's OAuth complexity** — Dev Dashboard apps require a full authorization code grant flow; implemented the complete OAuth handshake and token exchange rather than relying on simpler but unsupported client credentials
