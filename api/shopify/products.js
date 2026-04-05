const { shopifyFetch, verifyAuth, corsHeaders } = require("../../lib/shopify");

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  if (!verifyAuth(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const { query, collection } = req.method === "POST" ? req.body : req.query;

    if (!query && !collection) {
      return res.status(400).json({
        error: "Please provide a search query or collection handle.",
      });
    }

    let products = [];

    if (query) {
      // Search products by title/vendor/product_type
      const data = await shopifyFetch(
        `products.json?title=${encodeURIComponent(query)}&limit=5&status=active`
      );
      products = data.products || [];

      // If no results by title, try general search
      if (products.length === 0) {
        const searchData = await shopifyFetch(
          `products.json?limit=20&status=active`
        );
        const allProducts = searchData.products || [];
        const q = query.toLowerCase();
        products = allProducts.filter(
          (p) =>
            p.title.toLowerCase().includes(q) ||
            (p.vendor && p.vendor.toLowerCase().includes(q)) ||
            (p.product_type && p.product_type.toLowerCase().includes(q)) ||
            (p.tags && p.tags.toLowerCase().includes(q))
        ).slice(0, 5);
      }
    } else if (collection) {
      // Get products from a specific collection
      // First find the collection
      const colData = await shopifyFetch(
        `custom_collections.json?handle=${encodeURIComponent(collection)}&limit=1`
      );
      const collections = colData.custom_collections || [];

      if (collections.length > 0) {
        const colId = collections[0].id;
        const prodData = await shopifyFetch(
          `collections/${colId}/products.json?limit=10`
        );
        products = prodData.products || [];
      }
    }

    if (products.length === 0) {
      return res.status(200).json({
        found: false,
        message: `No products found matching "${query || collection}". Try a different search term.`,
      });
    }

    const storeUrl = "https://paintaccess.com.au";

    const results = products.map((p) => {
      const variants = (p.variants || []).map((v) => ({
        title: v.title,
        price: v.price,
        sku: v.sku,
        available: v.inventory_quantity > 0,
        inventory_quantity: v.inventory_quantity,
      }));

      return {
        title: p.title,
        url: `${storeUrl}/products/${p.handle}`,
        vendor: p.vendor,
        product_type: p.product_type,
        price_range: {
          min: Math.min(...(p.variants || []).map((v) => parseFloat(v.price))),
          max: Math.max(...(p.variants || []).map((v) => parseFloat(v.price))),
        },
        available:
          p.variants && p.variants.some((v) => v.inventory_quantity > 0),
        variants,
        image: p.image ? p.image.src : null,
      };
    });

    return res.status(200).json({
      found: true,
      products: results,
    });
  } catch (err) {
    console.error("Product search error:", err);
    return res.status(500).json({ error: "Failed to search products." });
  }
};
