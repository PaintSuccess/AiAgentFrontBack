<!-- ElevenLabs KB Doc | id: iLprP0WEHUQH8rbxIqJG | usage_mode: prompt -->
# Excluded Products & Restrictions

## Products NOT to Recommend
(Add products here that should NOT be recommended by the bot)

Example format:
- SKU: XXXX - Product Name - Reason (discontinued, recalled, etc.)

## Out-of-Stock Items to Redirect
(Add items that are permanently out of stock and what to suggest instead)

## Restricted Items
(Add items that require special handling, licenses, or cannot be shipped to certain areas)

## Price-Sensitive Items
(Add items where pricing should not be discussed and customer should contact trade@PaintAccess.com.au)
Вот чистый, структурированный документ — готовый для копирования:

---
Excluded Products & Restrictions

As we currently work directly with customers and operate through distributed warehousing, some orders may be fulfilled directly from supplier warehouses. Because of this, delivery times can occasionally be slightly longer than expected.

Certain product categories may require special handling. Products such as ZipWall and Norglass, as well as other items classified as dangerous goods, may incur additional shipping charges and, in some cases, slight delivery delays. This is due to strict courier regulations and liability requirements when transporting such materials.

At this stage, only a limited number of brands are unavailable for purchase. These include Uni-Pro and Rust-Oleum, as we are currently finalising supplier arrangements. These products may be visible on the website but cannot be purchased, as the purchase option is disabled.

All other brands and products on our website are fully available. If a product has an active “Add to Cart” button, it is in stock and available for purchase. This includes all DAN’S, Graco, and other listed brands.

If you are interested in trying the DAN’S Airless Backpack, it is available for demonstration at Inspirations Paint Chatswood in Sydney, which is our official distributor location.

📍 Address: Cnr Pacific Hwy & Nelson St, Chatswood NSW 2067, Australia

The store is conveniently located and offers easy access, with a large customer car park available on-site. This makes it easy to visit, test equipment, and receive professional advice from experienced staff.

Additionally, if you require consultation on any airless sprayer models, you are welcome to contact us directly. Our team is available to assist you with product selection and technical questions.

Regarding PaintAccess operations, we are currently based in Sydney and are in the process of expanding. While we do operate a warehouse in Sydney, it is not open to the public at this stage. However, our distribution network is well established, allowing us to efficiently supply products across Australia.

For businesses interested in developing their own brand, we also offer support with sourcing high-quality brushes, rollers, and accessories. You are welcome to contact us directly to request samples and discuss private label opportunities.

## Product Availability Rule for Shopify API

When the AI agent is connected to Shopify via API, it must follow these rules strictly when determining product availability.

The agent must not rely only on stock quantity (e.g. 0 or negative stock levels).

If the setting “Sell when out of stock” (Continue selling when out of stock) is ON, the product must be treated as available for purchase, regardless of inventory numbers (including 0 or negative values).

This means:

Even if stock shows 0, negative, or unavailable,
If “Sell when out of stock” is ON,
→ the product is available and can be sold

The agent must prioritise this rule over all inventory indicators.

Additionally:

If the Add to Cart button is active → the product is available
If “Sell when out of stock” is ON → the product is available

Only the following brands are currently unavailable:

Uni-Pro
Rust-Oleum

All other brands, including DAN’S, Graco, ZipWall, Norglass, and others, must be treated as available unless:

The Add to Cart button is disabled, AND
“Sell when out of stock” is OFF

Important:
ZipWall, Norglass, and other dangerous goods products may have:

Additional shipping charges
Slight delivery delays

However, they must NOT be described as unavailable unless purchasing is explicitly blocked.
