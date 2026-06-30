# KB Variant 3 Regression Tests

Use these tests before publishing the local Variant 3 KB refactor to ElevenLabs.

## Voice Quality Checks

Expected voice behavior:

- Reply in 1-3 sentences.
- Ask one question at a time.
- Do not read long lists, URLs, SKUs, or full scripts aloud.
- Use product tools before final product names, prices, availability, or links.

## Test Cases

### 1. General Product Start

Customer: "I need paint for a bedroom."

Expected:

- Ask what surface/room size or whether it is new/previously painted.
- Do not list all first-question prompts.
- Do not recommend specific products before enough context or product search.

### 2. DAN'S Name Clarification

Customer: "Do you have Dance Spray?"

Expected:

- Recognize as DAN'S cordless airless sprayer.
- Mention Backpack, Compact, or Wheeled only briefly.
- Ask what type of painting they plan to do.
- Use product search before final model names, prices, availability, or links.

### 3. Garage Floor Paint

Customer: "Are all your garage floor coatings out of stock?"

Expected:

- Do not say all garage coatings are out of stock.
- Mention Norglass oil-based polyurethane floor coating as an alternative.
- Ask whether the concrete is bare or previously painted.
- Mention test patch only if existing coating is relevant.

### 4. Availability With Zero Inventory

Customer: "This says zero stock. Can I still order it?"

Expected:

- Explain that Shopify purchase status controls availability.
- If Add to Cart / continue selling is enabled, treat as purchasable.
- Do not call it unavailable based only on inventory quantity.

### 5. Restricted Brand

Customer: "Can I buy Rust-Oleum?"

Expected:

- Explain Rust-Oleum currently requires unavailable-brand handling if purchase is disabled.
- Suggest checking the active product page or alternative product category.
- Escalate to team if the customer needs a specific replacement.

### 6. Mirka Detail Retrieval

Customer: "What's the difference between Abranet Ace and Galaxy?"

Expected:

- Use Product Knowledge & Painting Guides.
- Give a short comparison.
- Do not retrieve or discuss unrelated DAN'S or garage-floor rules.

### 7. Sprayer Troubleshooting

Customer: "My sprayer won't prime."

Expected:

- Use Paint Sprayers Trouble-Shoot.
- Start with a short safety reminder.
- Ask machine type/brand/model or symptom step by step.
- Do not read the whole troubleshooting script.

### 8. Paint Estimate

Customer: "How much paint do I need for a room?"

Expected:

- Use Conversation & Estimation Logic.
- Ask dimensions or room type step by step.
- Do not use the estimation document as a general greeting.

### 9. Order Tracking

Customer: "Where is my order?"

Expected:

- Verify identity according to order lookup rules.
- Use order/customer tools.
- Do not discuss product recommendation rules unless customer changes topic.

### 10. Voice Link Handling

Customer: "Can you send me the product links?"

Expected:

- Do not read long URLs aloud.
- Use website product cards when in widget, or offer SMS/email where appropriate.
