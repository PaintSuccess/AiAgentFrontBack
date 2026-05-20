# Paint Access — Full AI Communication System Plan

## Architecture Overview

```
                        ┌──────────────────────┐
                        │   ElevenLabs Agent    │
                        │  "Paint Access AI"    │
                        │  (Brain + Voice + KB) │
                        └──────┬───────────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
    ┌─────────▼──────┐ ┌──────▼───────┐ ┌──────▼───────┐
    │ Website Widget │ │ Phone (Voice)│ │ SMS/WhatsApp │
    │ (Client-side)  │ │ (Twilio)     │ │ (Twilio)     │
    └────────────────┘ └──────────────┘ └──────┬───────┘
              │                                 │
              │         ┌───────────────────────┘
              │         │
    ┌─────────▼─────────▼──────────────┐
    │     Backend API (Vercel)         │
    │  /api/shopify/orders             │
    │  /api/shopify/products           │
    │  /api/shopify/inventory          │
    │  /api/shopify/shipping           │
    │  /api/twilio/sms-webhook         │
    │  /api/twilio/whatsapp-webhook    │
    │  /api/email/send                 │
    │  /api/logs                       │
    └─────────────┬────────────────────┘
                  │
    ┌─────────────▼────────────────────┐
    │        Shopify Admin API         │
    │  Orders, Products, Inventory,    │
    │  Customers, Fulfillments,        │
    │  Shipping, Webhooks              │
    └──────────────────────────────────┘
```

## Implementation Phases

### Phase 1 — CURRENT (Done ✅)
- [x] ElevenLabs agent with knowledge base
- [x] Website voice/chat widget on Shopify theme
- [x] Twilio phone number connected for AI voice calls
- [x] Widget positioned above existing chat button

### Phase 2 — Enhanced Widget + Tools (This Session)
- [ ] Dynamic variables: pass customer name, email to widget
- [ ] Client tool: redirect to product pages
- [ ] Server tool: order tracking via Shopify API
- [ ] Server tool: email trigger
- [ ] Backend API on Vercel (Shopify middleware)
- [ ] Updated system prompt with tool instructions

### Phase 3 — SMS & WhatsApp
- [ ] Twilio SMS webhook → backend → ElevenLabs text API
- [ ] Twilio WhatsApp webhook → backend → ElevenLabs text API
- [ ] Two-way SMS conversations
- [ ] WhatsApp chatbot
- [ ] Cross-channel conversation threading

### Phase 4 — Full Shopify Integration
- [ ] Real-time inventory/product data access
- [ ] SKU and variant verification
- [ ] Live pricing access
- [ ] Shipping calculation and estimated delivery
- [ ] Shopify webhooks: order updates, fulfillment changes, inventory updates

### Phase 5 — Centralized Logging & Continuity
- [ ] Unified conversation log database
- [ ] Cross-channel customer identification
- [ ] Conversation history accessible across all channels
- [ ] Past orders and support history in AI context
- [ ] Admin dashboard for monitoring all interactions

---

## Tech Stack

| Component | Technology | Cost |
|---|---|---|
| AI Brain + Voice | ElevenLabs Conversational AI | Existing subscription |
| Phone | Twilio Voice → ElevenLabs | Existing subscription |
| SMS | Twilio Messaging → Backend → ElevenLabs | Per-message (~$0.05) |
| WhatsApp | Twilio WhatsApp → Backend → ElevenLabs | Per-message (~$0.05) |
| Backend API | Vercel Serverless Functions (Node.js) | Free tier (100K req/mo) |
| Database (logs) | Vercel KV (Redis) or Supabase | Free tier |
| E-commerce data | Shopify Admin API | Free (included with store) |
| Widget | ElevenLabs embed + Liquid | Free |

---

## Backend API Endpoints

### Shopify Integration
| Endpoint | Method | Purpose |
|---|---|---|
| `/api/shopify/order` | GET | Lookup order by number/email |
| `/api/shopify/products` | GET | Search products by name/SKU |
| `/api/shopify/inventory` | GET | Check stock for a variant |
| `/api/shopify/shipping` | GET | Calculate shipping estimate |
| `/api/shopify/customer` | GET | Lookup customer by email/phone |

### Communication
| Endpoint | Method | Purpose |
|---|---|---|
| `/api/twilio/sms-inbound` | POST | Receive incoming SMS |
| `/api/twilio/whatsapp-inbound` | POST | Receive incoming WhatsApp |
| `/api/email/send` | POST | Send email notification |

### Logging
| Endpoint | Method | Purpose |
|---|---|---|
| `/api/logs/conversation` | POST | Log a conversation event |
| `/api/logs/history` | GET | Retrieve conversation history |

---

## ElevenLabs Agent Tools

### Client Tools (run in browser)
| Tool | Description | Parameters |
|---|---|---|
| `navigate_to_product` | Redirects user to a product page | `url` (string) |
| `navigate_to_collection` | Redirects user to a collection | `url` (string) |
| `open_cart` | Opens the cart drawer | none |

### Server Tools (webhooks to backend)
| Tool | Description | Parameters |
|---|---|---|
| `lookup_order` | Get order status, tracking, fulfillment | `order_number` or `email` |
| `check_product_availability` | Check stock for a product/variant | `product_name` or `sku` |
| `get_shipping_estimate` | Calculate shipping cost/time | `postcode`, `product_ids` |
| `send_email_notification` | Trigger email to customer or staff | `to`, `subject`, `message` |
| `lookup_customer` | Get customer details by email/phone | `email` or `phone` |

---

## Shopify API Requirements

### Custom App Setup
1. Go to Settings → Apps and sales channels → Develop apps
2. Create "Paint Access AI Backend" app
3. Configure Admin API scopes:
   - `read_orders` — order lookup
   - `read_products` — product/inventory search
   - `read_inventory` — stock levels
   - `read_customers` — customer lookup
   - `read_shipping` — shipping rates
   - `read_fulfillments` — tracking info
4. Install the app → get Admin API access token
5. Store token in backend environment variables

### Webhooks to Register
| Event | Purpose |
|---|---|
| `orders/updated` | Update cached order data |
| `fulfillments/create` | Notify customer of shipment |
| `inventory_levels/update` | Keep stock data current |

---

## Security Considerations

- Shopify Admin API token stored as Vercel environment secret
- Backend endpoints authenticated with Bearer token (from ElevenLabs server tool headers)
- Twilio webhook signature validation on SMS/WhatsApp endpoints
- Customer data: only expose what's relevant (no full addresses, no payment info)
- Rate limiting on all endpoints
- CORS locked to paintaccess.com.au

---

## Revert Plan

| Component | How to revert |
|---|---|
| Widget | Remove 3 lines from theme.liquid, push via Shopify CLI |
| ElevenLabs agent | Delete from ElevenLabs dashboard |
| Phone connection | Remove from ElevenLabs Phone Numbers |
| Backend | Delete Vercel project |
| Shopify custom app | Uninstall from Apps in admin |
| SMS/WhatsApp | Remove Twilio webhook URLs |
