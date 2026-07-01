# Supplier PO automation options

Use this reference when the user asks whether the Shopify order -> supplier PO -> Gmail process can run automatically.

## Manual ChatGPT run

Best for testing supplier rules.

Flow:

```text
User asks to check an order
-> Shopify order lookup
-> supplier mapping
-> PO draft
-> Gmail draft if requested
-> Shopify timeline/tag update if requested
```

Limits:

- Requires manual user start.
- Does not continuously monitor Shopify in the background.

## Shopify Flow + Make/Zapier + Gmail

Best MVP for simple supplier rules.

Flow:

```text
New paid order in Shopify
-> line item / SKU / vendor / tag check
-> supplier mapping
-> PO generation
-> Gmail/SMTP email
-> Shopify tag or timeline update
```

Use this when the user wants a fast no-code/low-code setup.

## Custom middleware

Best long-term option for complex rules.

Flow:

```text
Shopify webhook orders/paid
-> backend rules engine
-> supplier-specific PO generator
-> Gmail API or SMTP
-> Shopify Admin API timeline/tag/metafield update
-> logging and duplicate prevention
```

Use this when the user has:

- many supplier-specific exceptions;
- split orders by supplier;
- SKU transformations;
- bundle logic;
- duplicate-send prevention;
- status logging needs.
