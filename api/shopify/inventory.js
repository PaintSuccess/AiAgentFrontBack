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
        matchedVariants.push({
          product_title: product.title,
          variant_title: variant.title,
          sku: variant.sku,
          price: variant.price,
          inventory_quantity: variant.inventoryQuantity,
          available: variant.inventoryQuantity > 0,
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
