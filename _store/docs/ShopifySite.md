https://www.paintaccess.com.au/

https://admin.shopify.com/store/zgmzge-0d

---

# Paint Access — AI Support Integration Options (Twilio + ElevenLabs)

**Store:** paintaccess.com.au (Shopify)  
**Current contact:** Phone 028-064-70-50 | SMS +61410609617 | trade@PaintAccess.com.au  
**Business type:** B2B/B2C Australian paint supplies & equipment e-commerce  

---

## What We're Building

An AI-powered customer support system that can:
- Answer questions about products (paint sprayers, accessories, surface prep, etc.)
- Handle order status inquiries
- Provide painting advice/guides
- Speak naturally with realistic voice (ElevenLabs)
- Work over phone calls (Twilio) and/or website chat

---

## Option A — Website Voice/Chat Widget Only (Simplest)

**Stack:** ElevenLabs Conversational AI Widget → Shopify theme  
**No Twilio needed.** No phone number, no telephony costs.

### How It Works
1. Create an ElevenLabs Agent in the dashboard (elevenlabs.io/app/agents)
2. Configure system prompt with Paint Access product knowledge, FAQ, painting guides
3. Upload knowledge base (product catalog, FAQ docs, painting guides)
4. Select a voice (Australian English recommended)
5. Embed the widget into Shopify theme with 2 lines of code:

```html
<elevenlabs-convai agent-id="<your-agent-id>"></elevenlabs-convai>
<script src="https://unpkg.com/@elevenlabs/convai-widget-embed" async type="text/javascript"></script>
```

### Where to Add in Shopify
- **Theme editor** → Edit code → `theme.liquid` (before `</body>`)
- Or use a **Custom Liquid block** on specific pages

### Features
- Voice + text multimodal chat
- Customizable widget colors to match Paint Access branding
- Client tools: redirect to product pages, trigger email, open order tracking
- Dynamic variables: pass logged-in customer name, order info
- Knowledge base RAG for accurate product answers
- Conversation history & analytics in ElevenLabs dashboard

### Cost
- ElevenLabs Scale plan: ~$99/mo (includes conversational AI minutes)
- No Twilio costs
- No backend infrastructure needed

### Pros
- Fastest to deploy (can be live in 1 day)
- Zero backend code needed
- Works on all pages of the store
- Supports voice AND text
- Full analytics dashboard

### Cons
- No phone call support (website only)
- Customers can't call a phone number to reach AI
- Widget only available when customer is on the website

---

## Option B — Phone Support via Twilio + ElevenLabs Native Integration (Recommended)

**Stack:** Twilio Phone Number → ElevenLabs Native Twilio Integration → ElevenLabs Agent  
**This is the officially supported, simplest phone integration.**

### How It Works
1. Buy an Australian phone number on Twilio (+61 number)
2. Create an ElevenLabs Agent with Paint Access knowledge base
3. In ElevenLabs dashboard → Phone Numbers → Import from Twilio
4. Enter: Twilio Account SID + Auth Token + Phone Number
5. ElevenLabs **automatically configures** the Twilio number (webhook, etc.)
6. Assign your agent to the phone number
7. Customers call → AI agent answers with natural voice

### Setup Steps
1. **Twilio:** Sign up → Buy AU phone number (~$5-15/mo) → Get Account SID & Auth Token
2. **ElevenLabs:** Create agent → Configure prompt + knowledge base + voice
3. **ElevenLabs Dashboard:** Phone Numbers tab → "Import from Twilio" → Enter credentials
4. **Assign agent** to the number
5. **Test** by calling the number
6. **Shopify:** Add phone number to store header/footer/contact page

### Features
- Inbound calls: customers call, AI answers
- Outbound calls: AI can call customers (follow-up, order confirmation)
- Natural conversation with turn-taking, interruptions
- Call recording and transcription
- Conversation analytics and success evaluation
- Data collection from calls (customer questions, product interests)

### Cost
- ElevenLabs Scale plan: ~$99/mo
- Twilio AU phone number: ~$5-15/mo
- Twilio per-minute inbound: ~$0.0085/min
- Twilio per-minute outbound: ~$0.04/min (to AU numbers)
- Estimated total for moderate usage: **$120-200/mo**

### Pros
- Native integration — no custom code needed
- ElevenLabs handles all the Twilio configuration automatically
- Real phone number customers can call
- Both inbound and outbound supported
- Full conversation analytics
- Can combine with Option A (widget + phone)

### Cons
- Monthly Twilio + ElevenLabs costs
- Per-minute telephony charges add up with high call volume
- Phone audio quality limited to G711/G722 (telephony standard)

---

## Option C — Full Omnichannel: Website Widget + Phone + SMS

**Stack:** Twilio (Phone + SMS) + ElevenLabs Agent + Shopify Theme + Small Backend

### How It Works
Combines Option A and B, plus adds SMS support via Twilio Messaging.

1. **Website:** ElevenLabs widget embedded in Shopify theme
2. **Phone:** Twilio number → ElevenLabs native integration
3. **SMS:** Twilio number → small serverless function → ElevenLabs API for text responses
4. **Optional:** Twilio Studio flow for routing (press 1 for AI, press 2 for human)

### Additional Components Needed
- Small backend (Twilio Functions / serverless) for SMS handling
- Twilio Studio for IVR routing (optional)
- Webhook endpoint for order lookups via Shopify API

### Features
- Everything from Options A + B
- SMS support on the same Twilio number
- IVR menu: "Press 1 for AI assistant, Press 2 for human support"
- Escalation to human agent (email notification or transfer)
- Shopify order lookup integration (customer says order number → agent checks status)
- Product recommendation based on conversation

### Cost
- ElevenLabs Scale/Business: $99-330/mo
- Twilio phone + SMS: ~$20-50/mo (number + usage)
- Serverless hosting (Twilio Functions): included in Twilio
- Estimated total: **$200-400/mo**

### Pros
- Complete coverage: web, phone, SMS
- Professional IVR with human escalation fallback
- Deepest Shopify integration possible
- Best customer experience

### Cons
- Most complex to set up
- Requires some backend development for SMS + Shopify API
- Higher monthly cost
- More to maintain

---

## Option D — ElevenLabs + SIP Trunk (Bring Your Own Carrier)

**Stack:** Any AU Telephony Provider → SIP Trunk → ElevenLabs Agent

### How It Works
If Paint Access already has a business phone system (PBX), connect it directly to ElevenLabs via SIP trunking without needing Twilio at all.

1. Configure SIP trunk in ElevenLabs dashboard
2. Point existing phone system to `sip.rtc.elevenlabs.io:5060`
3. Calls route to ElevenLabs agent
4. Supports TLS encryption + media encryption

### When to Choose This
- Paint Access already has a PBX/VoIP system
- Want to keep existing phone number and carrier
- Don't want to use Twilio

### Pros
- Use existing phone infrastructure
- No Twilio dependency
- Works with any SIP-compatible provider

### Cons
- Requires SIP/telephony knowledge to configure
- More complex initial setup
- Need to manage carrier relationship separately

---

## Comparison Matrix

| Feature | A: Widget Only | B: Twilio + EL (Recommended) | C: Omnichannel | D: SIP Trunk |
|---|---|---|---|---|
| Website voice/chat | Yes | No (add A for this) | Yes | No (add A for this) |
| Phone calls | No | Yes | Yes | Yes |
| SMS support | No | No | Yes | No |
| Setup complexity | Very Low | Low | Medium-High | Medium |
| Monthly cost | ~$99 | ~$120-200 | ~$200-400 | ~$99 + carrier |
| Custom code needed | None | None | Some | Some |
| Human escalation | No | No | Yes | Depends |
| Shopify order lookup | No | No | Yes | Depends |
| Time to deploy | 1 day | 1-2 days | 1-2 weeks | 2-5 days |

---

## My Recommendation

**Start with Option B + A combined:**

1. Deploy the **ElevenLabs widget** on the Shopify site (Option A) — immediate value, 1 day
2. Set up **Twilio AU phone number** with ElevenLabs native integration (Option B) — 1-2 days
3. Add the phone number to the store's contact section
4. Monitor analytics for 2-4 weeks
5. **If needed**, expand to Option C for SMS + human escalation

This gives Paint Access both web and phone AI support with minimal complexity, and leaves room to grow.

---

## Accounts Needed

| Service | URL | What For |
|---|---|---|
| ElevenLabs | elevenlabs.io | AI agent, voice, knowledge base, widget |
| Twilio | twilio.com | Australian phone number, telephony |
| Shopify (existing) | admin.shopify.com/store/zgmzge-0d | Theme code for widget embed |

---

## Decision: Option A + B Combined

**Selected approach:** Website widget + Twilio phone support  
**Client has:** ElevenLabs API keys + Twilio phone number

---

## Cost Breakdown — What's Free, What's Not

| Component | Cost | Notes |
|---|---|---|
| **Shopify integration code** | **FREE** | No app, no subscription — just 2 lines of HTML in theme.liquid |
| **Setup scripts (this repo)** | **FREE** | Node.js scripts, Playwright automation — all open source tooling |
| **ElevenLabs widget embed** | **FREE** | Part of existing ElevenLabs subscription |
| **Twilio ↔ ElevenLabs connection** | **FREE** | Native integration, no middleware needed |
| **Knowledge base** | **FREE** | URL indexing + markdown document upload |
| ElevenLabs subscription | Already have | Agent minutes, TTS, knowledge base RAG |
| Twilio phone number | Already have | Per-minute charges apply |
| Playwright (browser automation) | FREE | Open source, used for Shopify theme deployment |

**Bottom line:** The Shopify solution itself is $0. The only ongoing costs are the existing ElevenLabs + Twilio subscriptions.

---

## Implementation — setup/ folder

### Project Structure

```
setup/
├── package.json           # Dependencies (dotenv, playwright)
├── .env.example           # Credentials template
├── .env                   # Your actual credentials (git-ignored)
├── setup-all.js           # Main orchestrator — runs all 3 steps
├── create-agent.js        # Step 1: Creates ElevenLabs agent via API
├── connect-phone.js       # Step 2: Imports Twilio number + assigns agent
├── deploy-widget.js       # Step 3: Playwright injects widget into Shopify theme
├── knowledge-base.md      # Paint Access knowledge base for the agent
└── snippets/
    └── widget.liquid      # The Liquid snippet for reference
```

### How to Run

```bash
cd setup
cp .env.example .env        # Fill in your API keys
npm install
npm run install-browsers     # First time: downloads Chromium for Playwright
npm run setup                # Runs all 3 steps in sequence
```

### What Each Script Does

**Step 1 — `create-agent.js`** (ElevenLabs API)
- Creates an agent named "Paint Access Support"
- Sets up system prompt with store knowledge
- Sets Australian-friendly first message
- Adds paintaccess.com.au homepage, FAQ, and painting guides as URL knowledge sources
- Uploads knowledge-base.md as document knowledge source
- Saves ELEVENLABS_AGENT_ID to .env

**Step 2 — `connect-phone.js`** (ElevenLabs API)
- Imports the Twilio phone number into ElevenLabs via native integration
- ElevenLabs automatically configures Twilio webhooks
- Assigns the agent to handle all inbound calls
- Saves ELEVENLABS_PHONE_NUMBER_ID to .env

**Step 3 — `deploy-widget.js`** (Playwright → Shopify Admin)
- Opens Shopify admin in a real browser
- Waits for you to log in (handles 2FA, SSO, etc.)
- Navigates to theme code editor
- Opens layout/theme.liquid
- Injects the ElevenLabs widget snippet before `</body>`
- Saves the file
- Result: chat bubble appears on every page of paintaccess.com.au

### Running Steps Individually

```bash
npm run create-agent      # Only Step 1
npm run connect-phone     # Only Step 2
npm run deploy-widget     # Only Step 3
```

---

## Next Steps

- [x] Client selected Option A + B combined
- [ ] Fill in .env with ElevenLabs API key, Twilio SID/token/number
- [ ] Run `npm run setup` from setup/ folder
- [ ] Verify widget on paintaccess.com.au
- [ ] Call Twilio number to test phone agent
- [ ] Review conversation history at elevenlabs.io/app/agents/history
- [ ] Fine-tune agent prompt based on real conversations
- [ ] Add phone number to store's contact page / header