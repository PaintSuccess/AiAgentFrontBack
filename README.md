# Paint Access — AI Agent Backend

Vercel serverless backend for the Paint Access AI support system. Acts as middleware between ElevenLabs Conversational AI and Shopify Admin API.

## Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/shopify/order` | POST | Order lookup by number or email |
| `/api/shopify/oauth-start` | GET | Shopify app reinstall/reauthorization helper for Admin API scopes; can auto-store the new token in Vercel |
| `/api/google/oauth-start` | GET | Google Gmail/Drive authorization helper; can auto-store the refresh token in Vercel |
| `/api/shopify/products` | POST | Product search by name/brand/type |
| `/api/shopify/inventory` | POST | Stock availability check |
| `/api/email/send` | POST | Email request via Shopify Draft Order |
| `/api/twilio/sms-send` | POST | Send storefront SMS form replies through Twilio |
| `/api/twilio/sms-inbound` | POST | Incoming SMS webhook (Twilio) |
| `/api/whatsapp/inbound` | GET/POST | Production WhatsApp webhook for Twilio WhatsApp Senders or Meta Cloud API |
| `/api/whatsapp/send` | POST | Protected outbound WhatsApp send endpoint for support replies/templates |
| `/api/whatsapp/status` | POST | Twilio WhatsApp delivery status callback receiver |
| `/api/twilio/whatsapp-inbound` | POST | Backward-compatible Twilio WhatsApp webhook alias |
| `/api/mcp/shopify` | GET/POST | PaintAccess Operations MCP for ChatGPT agents: Shopify, Gmail, Drive, and approval-gated email tools |
| `/.well-known/oauth-protected-resource` | GET | OAuth protected resource metadata for ChatGPT MCP authorization |
| `/.well-known/oauth-authorization-server` | GET | OAuth authorization server metadata for ChatGPT MCP authorization |
| `/api/webhooks/elevenlabs-post-call` | POST | ElevenLabs completed conversation transcript webhook |
| `/api/webhooks/elevenlabs-twilio-personalization` | POST | ElevenLabs inbound Twilio call personalization webhook |
| `/api/dashboard/communication` | GET | Unified communication detail for chat, voice, SMS, and WhatsApp |

## Environment Variables

Set in Vercel Dashboard → Settings → Environment Variables:

| Variable | Description |
|---|---|
| `SHOPIFY_STORE` | Shopify store domain (e.g., `zgmzge-0d.myshopify.com`) |
| `SHOPIFY_ACCESS_TOKEN` | Shopify Admin API access token |
| `SHOPIFY_ADMIN_API_VERSION` | Shopify Admin API version for operations tools, defaults to `2026-04` |
| `SHOPIFY_MCP_TOKEN` | Legacy/private MCP bearer token fallback |
| `MCP_OAUTH_TOKEN_SECRET` | Signing secret for ChatGPT OAuth-issued MCP access tokens |
| `MCP_OAUTH_PIN` | Optional PIN required on the ChatGPT app authorization screen |
| `MCP_OAUTH_AUTO_APPROVE` | Optional `true` only for tightly controlled testing; defaults to explicit consent |
| `PUBLIC_BASE_URL` | Public app origin used in OAuth metadata |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID for backend Gmail/Drive tools |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret for backend Gmail/Drive tools |
| `GOOGLE_REFRESH_TOKEN` | Google refresh token for the PaintAccess mailbox/Drive account |
| `GOOGLE_WORKSPACE_EMAIL` | Optional label for the authorized Google account |
| `GOOGLE_OAUTH_ADMIN_PIN` | Optional PIN required to start Google Gmail/Drive authorization |
| `VERCEL_API_TOKEN` | Optional. Enables OAuth callbacks to upsert refreshed tokens into Vercel env vars |
| `VERCEL_PROJECT_ID_OR_NAME` | Optional. Vercel project id/name used with `VERCEL_API_TOKEN` |
| `VERCEL_TEAM_ID` / `VERCEL_TEAM_SLUG` | Optional. Required only when the Vercel project belongs to a team and the API token needs team routing |
| `VERCEL_DEPLOY_HOOK_URL` | Optional. Triggered after token upsert so production picks up new env vars |
| `ELEVENLABS_API_KEY` | ElevenLabs API key |
| `ELEVENLABS_AGENT_ID` | ElevenLabs agent ID |
| `API_SECRET_TOKEN` | Bearer token for endpoint auth |
| `TWILIO_ACCOUNT_SID` | Twilio account SID for SMS/call APIs |
| `TWILIO_AUTH_TOKEN` | Twilio auth token for API auth and webhook verification |
| `TWILIO_MOBILE_NUMBER` | SMS-capable Twilio sender number in E.164 format |
| `TWILIO_SYDNEY_NUMBER` | Voice-capable Sydney/local Twilio number for direct calls |
| `TWILIO_WHATSAPP_NUMBER` | Approved Twilio WhatsApp Sender number in E.164 format |
| `TWILIO_MESSAGING_SERVICE_SID` | Optional Twilio Messaging Service SID for WhatsApp sends |
| `ELEVENLABS_PHONE_NUMBER_ID_MOBILE` | ElevenLabs imported phone number ID for the mobile number |
| `ELEVENLABS_PHONE_NUMBER_ID_SYDNEY` | ElevenLabs imported phone number ID for the Sydney/local number |
| `WHATSAPP_PROVIDER` | `twilio` for production Twilio sender, or `meta` for direct Meta Cloud API |
| `META_GRAPH_VERSION` | Meta Graph API version for direct Cloud API sends, defaults to `v23.0` |
| `META_WHATSAPP_VERIFY_TOKEN` | Verify token used by Meta webhook setup if using direct Cloud API |
| `META_WHATSAPP_ACCESS_TOKEN` | Direct Meta Cloud API access token, only needed when `WHATSAPP_PROVIDER=meta` |
| `META_WHATSAPP_PHONE_NUMBER_ID` | Direct Meta Cloud API phone number ID, only needed when `WHATSAPP_PROVIDER=meta` |
| `META_APP_SECRET` | Optional Meta app secret for webhook signature verification |
| `TRADE_NOTIFICATION_EMAIL` | Trade notification inbox, defaults to `Trade@paintaccess.com.au` |
| `SENDGRID_API_KEY` | Optional. If present, Trade notifications send through SendGrid |
| `SENDGRID_FROM_EMAIL` | Optional SendGrid sender address |
| `SENDGRID_FROM_NAME` | Optional SendGrid sender name |
| `ELEVENLABS_WEBHOOK_SECRET` | Optional ElevenLabs webhook HMAC secret |
| `ELEVENLABS_TWILIO_PERSONALIZATION_TOKEN` | Optional bearer/header token for the inbound Twilio personalization webhook. Falls back to `API_SECRET_TOKEN` when unset |

## Communication Logs

The Shopify app dashboard combines ElevenLabs conversations, Twilio SMS/WhatsApp messages, Twilio call records, and Shopify email requests into one timeline. Click any chat, call, SMS, or WhatsApp row to open the normalized record details.

Trade notifications are sent to `TRADE_NOTIFICATION_EMAIL` from the ElevenLabs completed conversation webhook, so the email contains the finished AI session transcript rather than one transport message at a time. Twilio SMS/WhatsApp/call rows remain available in the dashboard as raw delivery/call audit records. With no SendGrid key configured, the app uses the existing Shopify Draft Order invoice email pattern so no new email provider is required.

## WhatsApp Production Setup

For the current client path, create a production WhatsApp Sender in Twilio and connect it to the Paint Access Meta Business account during Twilio's "Continue with Facebook" flow. Configure the sender's inbound webhook as:

```text
POST https://ai-agent-front-back.vercel.app/api/whatsapp/inbound
```

Configure the sender's status callback URL as:

```text
POST https://ai-agent-front-back.vercel.app/api/whatsapp/status
```

Set `WHATSAPP_PROVIDER=twilio` and `TWILIO_WHATSAPP_NUMBER` to the approved sender number. Incoming WhatsApp users are tagged in Shopify as `WhatsApp` and `WhatsApp Lead`, with `paintaccess.whatsapp_phone` stored as a customer metafield when customer write scopes are available.

## Deploy

Connected to Vercel via GitHub. Push to `main` → auto-deploys.

## Admin OAuth Helpers

Google Gmail/Drive:

```text
https://ai-agent-front-back.vercel.app/api/google/oauth-start?pin=YOUR_PIN
```

Shopify Admin API:

```text
https://ai-agent-front-back.vercel.app/api/shopify/oauth-start
```

If `VERCEL_API_TOKEN` and `VERCEL_PROJECT_ID_OR_NAME` are configured, the callback writes `GOOGLE_REFRESH_TOKEN` or `SHOPIFY_ACCESS_TOKEN` directly into Vercel. If a deploy hook is configured, it also triggers redeploy. Otherwise the callback page shows the token for manual entry.
