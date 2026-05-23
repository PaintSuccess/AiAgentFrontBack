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
| `/api/webhooks/elevenlabs-post-call` | POST | ElevenLabs completed conversation transcript webhook |
| `/api/dashboard/communication` | GET | Unified communication detail for chat, voice, SMS, and WhatsApp |

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
| `TRADE_NOTIFICATION_EMAIL` | Trade notification inbox, defaults to `Trade@paintaccess.com.au` |
| `SENDGRID_API_KEY` | Optional. If present, Trade notifications send through SendGrid |
| `SENDGRID_FROM_EMAIL` | Optional SendGrid sender address |
| `SENDGRID_FROM_NAME` | Optional SendGrid sender name |
| `ELEVENLABS_WEBHOOK_SECRET` | Optional ElevenLabs webhook HMAC secret |

## Communication Logs

The Shopify app dashboard combines ElevenLabs conversations, Twilio SMS/WhatsApp messages, Twilio call records, and Shopify email requests into one timeline. Click any chat, call, SMS, or WhatsApp row to open the normalized record details.

Trade notifications are sent to `TRADE_NOTIFICATION_EMAIL` whenever the AI handles SMS, WhatsApp, the storefront SMS form, or an ElevenLabs completed conversation webhook. With no SendGrid key configured, the app uses the existing Shopify Draft Order invoice email pattern so no new email provider is required.

## Deploy

Connected to Vercel via GitHub. Push to `main` → auto-deploys.
