const { shopifyFetch, verifyAuth, corsHeaders } = require("../../lib/shopify");

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  if (!verifyAuth(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const { product_name, sku } = req.method === "POST" ? req.body : req.query;

    if (!product_name && !sku) {
      return res.status(400).json({
        error: "Please provide a product_name or sku.",
      });
    }

    // Get products to check inventory
    const data = await shopifyFetch(`products.json?limit=50&status=active`);
    const allProducts = data.products || [];

    let matchedVariants = [];

    for (const product of allProducts) {
      for (const variant of product.variants || []) {
        const matchesSku = sku && variant.sku && variant.sku.toLowerCase() === sku.toLowerCase();
        const matchesName = product_name && product.title.toLowerCase().includes(product_name.toLowerCase());

        if (matchesSku || matchesName) {
          matchedVariants.push({
            product_title: product.title,
            variant_title: variant.title,
            sku: variant.sku,
            price: variant.price,
            inventory_quantity: variant.inventory_quantity,
            available: variant.inventory_quantity > 0,
            url: `https://paintaccess.com.au/products/${product.handle}`,
          });
        }
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
