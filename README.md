# Paint Access — AI Agent Backend

Vercel serverless backend for the Paint Access AI support system. Acts as middleware between ElevenLabs Conversational AI and Shopify Admin API.

## Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/shopify/order` | POST | Order lookup by number or email |
| `/api/shopify/products` | POST | Product search by name/brand/type |
| `/api/shopify/inventory` | POST | Stock availability check |
| `/api/email/send` | POST | Email request via Shopify Draft Order |
| `/api/twilio/sms-inbound` | POST | Incoming SMS webhook (Twilio) |
| `/api/twilio/whatsapp-inbound` | POST | Incoming WhatsApp webhook (Twilio) |

## Environment Variables

Set in Vercel Dashboard → Settings → Environment Variables:

| Variable | Description |
|---|---|
| `SHOPIFY_STORE` | Shopify store domain (e.g., `zgmzge-0d.myshopify.com`) |
| `SHOPIFY_ACCESS_TOKEN` | Shopify Admin API access token |
| `ELEVENLABS_API_KEY` | ElevenLabs API key |
| `ELEVENLABS_AGENT_ID` | ElevenLabs agent ID |
| `API_SECRET_TOKEN` | Bearer token for endpoint auth |

## Deploy

Connected to Vercel via GitHub. Push to `main` → auto-deploys.
