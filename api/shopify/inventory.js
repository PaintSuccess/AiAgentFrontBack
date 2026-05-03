const { shopifyGraphQL, verifyAuth, corsHeaders, rateLimit, sanitizeInput } = require("../../lib/shopify");

const INVENTORY_QUERY = `
  query inventorySearch($query: String!) {
    products(first: 10, query: $query) {
      edges {
        node {
          title
          handle
          variants(first: 10) {
            edges {
              node {
                title
                sku
                price
                inventoryQuantity
                inventoryPolicy
                inventoryItem {
                  tracked
                }
              }
            }
          }
        }
      }
    }
  }
`;

module.exports = async function handler(req, res) {
  corsHeaders(res, req);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (rateLimit(req, res)) return;

  if (!verifyAuth(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const params = req.method === "POST" ? req.body : req.query;
    const product_name = sanitizeInput(params.product_name);
    const sku = sanitizeInput(params.sku, 50);

    if (!product_name && !sku) {
      return res.status(400).json({
        error: "Please provide a product_name or sku.",
      });
    }

    // Build search query — GraphQL searches across title, SKU, vendor, tags, etc.
    const searchTerm = sku || product_name;
    const searchQuery = `status:active ${searchTerm}`;
    const data = await shopifyGraphQL(INVENTORY_QUERY, { query: searchQuery });
    const productNodes = (data.products?.edges || []).map((e) => e.node);

    let matchedVariants = [];

    for (const product of productNodes) {
      for (const edge of product.variants?.edges || []) {
        const variant = edge.node;
        const tracked = variant.inventoryItem?.tracked !== false;
        const policy = variant.inventoryPolicy || "DENY";
        const qty = variant.inventoryQuantity ?? 0;
        // Available if: inventory not tracked, OR sell-when-out-of-stock is ON, OR qty > 0
        const available = !tracked || policy === "CONTINUE" || qty > 0;

        matchedVariants.push({
          product_title: product.title,
          variant_title: variant.title,
          sku: variant.sku,
          price: variant.price,
          inventory_quantity: qty,
          inventory_policy: policy,
          inventory_tracked: tracked,
          sell_when_out_of_stock: policy === "CONTINUE",
          available,
          availability_reason: !tracked
            ? "not_tracked"
            : policy === "CONTINUE"
            ? "sell_when_out_of_stock_enabled"
            : qty > 0
            ? "in_stock"
            : "out_of_stock",
          url: `https://paintaccess.com.au/products/${product.handle}`,
        });
      }
    }

    if (matchedVariants.length === 0) {
      return res.status(200).json({
        found: false,
        message: `No products found matching "${product_name || sku}".`,
      });
    }

    return res.status(200).json({
      found: true,
      inventory: matchedVariants.slice(0, 10),
    });
  } catch (err) {
    console.error("Inventory check error:", err);
    return res.status(500).json({ error: "Failed to check inventory." });
  }
};
