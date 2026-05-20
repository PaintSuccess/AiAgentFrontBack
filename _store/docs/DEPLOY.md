# Deployment Guide — Paint Access AI Backend

## Prerequisites
- [Vercel CLI](https://vercel.com/docs/cli) installed: `npm i -g vercel`
- [Shopify Admin API token](#step-1-create-shopify-custom-app) from a Custom App
- Network/internet access

---

## Step 1: Create Shopify Custom App

This gives us API access to orders, products, inventory, and customers.

1. Go to **Shopify Admin** → Settings → Apps and sales channels → **Develop apps**
2. Click **Create an app** → Name it **"Paint Access AI Backend"**
3. Click **Configure Admin API scopes** and enable:
   - `read_orders`
   - `read_products`
   - `read_inventory`
   - `read_customers`
   - `read_fulfillments`
4. Click **Install app** → Confirm
5. Copy the **Admin API access token** (shown only once!)
6. Save this token — you'll need it in Step 3

---

## Step 2: Deploy Backend to Vercel

```bash
cd backend
npm install
vercel login          # Login to Vercel (free account)
vercel                # First deploy (follow prompts, accept defaults)
```

Note your deployment URL (e.g., `https://paintaccess-ai-backend.vercel.app`).

---

## Step 3: Set Environment Variables in Vercel

Go to Vercel Dashboard → your project → Settings → Environment Variables, and add:

| Variable | Value |
|---|---|
| `SHOPIFY_STORE` | `zgmzge-0d.myshopify.com` |
| `SHOPIFY_ACCESS_TOKEN` | *(from Step 1)* |
| `ELEVENLABS_API_KEY` | `sk_25a11646b2c2388a7754203d2addfdf02c78388deafd3045` |
| `ELEVENLABS_AGENT_ID` | `agent_1001kn99pk1xefprh4gb665f6j3p` |
| `API_SECRET_TOKEN` | *(generate a random string, e.g., `openssl rand -hex 32`)* |
| `SENDGRID_API_KEY` | *(optional, for email sending)* |
| `SENDGRID_FROM_EMAIL` | `trade@PaintAccess.com.au` |

Then redeploy:
```bash
vercel --prod
```

---

## Step 4: Update Agent with Tools

After deploying the backend, update the setup script with the actual backend URL and API secret:

```bash
cd setup

# Edit update-agent.js — set BACKEND_URL and API_SECRET to match your Vercel values
# Then run:
node update-agent.js
```

This will:
- Add server tools (order lookup, product search, inventory check, email) to the ElevenLabs agent
- Update the system prompt with tool instructions and dynamic variables
- Update the first message greeting

---

## Step 5: Push Widget Changes to Shopify

```bash
cd theme
npx shopify theme push --store zgmzge-0d --theme 138089922663 --only "layout/theme.liquid" --allow-live --nodelete
```

This updates the widget to pass customer dynamic variables (name, email) when logged in.

---

## Step 6: Configure Twilio Webhooks (SMS/WhatsApp)

### SMS Setup
1. Go to [Twilio Console](https://console.twilio.com/) → Phone Numbers → +61488826453
2. Under **Messaging** → **A message comes in**:
   - Webhook URL: `https://YOUR-BACKEND.vercel.app/api/twilio/sms-inbound`
   - HTTP Method: POST

### WhatsApp Setup (requires Twilio WhatsApp approval)
1. Go to Twilio Console → Messaging → WhatsApp senders
2. Configure the webhook URL: `https://YOUR-BACKEND.vercel.app/api/twilio/whatsapp-inbound`
3. Method: POST

---

## Step 7: Verify Everything Works

### Test order lookup:
```bash
curl -X POST https://YOUR-BACKEND.vercel.app/api/shopify/order \
  -H "Authorization: Bearer YOUR_API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"order_number": "1001"}'
```

### Test product search:
```bash
curl -X POST https://YOUR-BACKEND.vercel.app/api/shopify/products \
  -H "Authorization: Bearer YOUR_API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"query": "graco sprayer"}'
```

### Test the widget:
1. Visit paintaccess.com.au
2. Click the AI widget
3. Ask "What Graco sprayers do you have?"
4. Ask "Can you check if order #1001 has shipped?"

### Test phone:
1. Call +61488826453
2. Ask about a product or order

### Test SMS:
1. Text +61488826453 with "Hi, do you have Graco sprayers?"
2. Should get an AI-powered reply

---

## Architecture Summary

```
Customer → Widget/Phone/SMS/WhatsApp
              ↓
         ElevenLabs Agent (AI brain)
              ↓ (server tools)
         Vercel Backend (middleware)
              ↓
         Shopify Admin API (data)
```

## Costs

| Service | Monthly Cost |
|---|---|
| Vercel (Hobby) | Free (100K requests) |
| ElevenLabs | Existing subscription |
| Twilio Voice | Existing subscription |
| Twilio SMS | ~$0.05/message |
| SendGrid | Free (100 emails/day) |
