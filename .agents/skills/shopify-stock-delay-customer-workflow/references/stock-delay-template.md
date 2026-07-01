# Stock delay template

## Successful prior case

Order #44478 for Michael Briffa used this pattern for Timbabuild products:

- Explain Timbabuild products are currently out of stock.
- Say distributor expects stock in approximately one week.
- Say PaintAccess will dispatch the order as soon as stock is available.
- Tell the customer no action is required at this stage.
- Ask the customer to confirm that waiting is okay.

## Email template

When sending with `shopify_send_customer_email` and `delivery_method: "order_invoice"`, use the body text below as the custom message and omit the plain signoff. Shopify adds the branded logo/contact/footer from the store notification template. Include the plain signoff only for Gmail drafts.

```text
Subject: Update on your PaintAccess order #{order_number}

Hi {customer_first_name},

Thank you for your order with PaintAccess.

We sincerely apologise, but we currently do not have the {product_or_brand} products in stock. Our distributor expects to have them back in stock in approximately {restock_timing}, and we will dispatch your order as soon as the stock becomes available.

You do not need to do anything at this stage. Please let us know if this is okay with you.

Thank you for your patience and understanding.
```

## Shopify timeline entry template

```text
PaintAccess Ops: Customer update drafted/sent regarding stock delay. Affected item: {product_or_brand}. Expected restock: {restock_timing}. Customer told order will dispatch when stock arrives and no action is required unless confirmation is requested.

Details:

{short_email_summary_or_copy_if_requested}
```
