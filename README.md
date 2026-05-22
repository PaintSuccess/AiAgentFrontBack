# Paint Access — AI Agent Backend

Vercel serverless backend for the Paint Access AI support system. Acts as middleware between ElevenLabs Conversational AI and Shopify Admin API.

## Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/shopify/order` | POST | Order lookup by number or email |
| `/api/shopify/products` | POST | Product search by name/brand/type |
| `/api/shopify/inventory` | POST | Stock availability check |
| `/api/email/send` | POST | Email request via Shopify Draft Order |
| `/api/twilio/sms-send` | POST | Send storefront SMS form replies through Twilio |
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
| `TWILIO_ACCOUNT_SID` | Twilio account SID for SMS/call APIs |
| `TWILIO_AUTH_TOKEN` | Twilio auth token for API auth and webhook verification |
| `TWILIO_MOBILE_NUMBER` | SMS-capable Twilio sender number in E.164 format |
| `TWILIO_SYDNEY_NUMBER` | Voice-capable Sydney/local Twilio number for direct calls |
| `ELEVENLABS_PHONE_NUMBER_ID_MOBILE` | ElevenLabs imported phone number ID for the mobile number |
| `ELEVENLABS_PHONE_NUMBER_ID_SYDNEY` | ElevenLabs imported phone number ID for the Sydney/local number |

## Deploy

Connected to Vercel via GitHub. Push to `main` → auto-deploys.
