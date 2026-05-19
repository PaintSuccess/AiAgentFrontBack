const { shopifyGraphQL, verifyAuth, corsHeaders, rateLimit, sanitizeInput } = require("../../lib/shopify");

// Brands that are currently visible on the site but NOT purchasable
// (per kb/excluded_products_restrictions__prompt.md — supplier arrangements pending)
const UNAVAILABLE_BRANDS = ["uni-pro", "unipro", "rust-oleum", "rustoleum"];

const PRODUCT_SEARCH_QUERY = `
  query searchProducts($query: String!) {
    products(first: 20, query: $query) {
      edges {
        node {
          title
          handle
          vendor
          productType
          tags
          status
          variants(first: 10) {
            edges {
              node {
                title
                price
                sku
                inventoryQuantity
                inventoryPolicy
                inventoryItem {
                  tracked
                }
              }
            }
          }
          featuredImage {
            url
          }
        }
      }
    }
  }
`;

const COLLECTION_SEARCH_QUERY = `
  query collectionProducts($handle: String!) {
    collectionByHandle(handle: $handle) {
      products(first: 10) {
        edges {
          node {
            title
            handle
            vendor
            productType
            tags
            variants(first: 10) {
              edges {
                node {
                  title
                  price
                  sku
                  inventoryQuantity
                  inventoryPolicy
                  inventoryItem {
                    tracked
                  }
                }
              }
            }
            featuredImage {
              url
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
    const query = sanitizeInput(params.query);
    const collection = sanitizeInput(params.collection, 100);

    if (!query && !collection) {
      return res.status(400).json({
        error: "Please provide a search query or collection handle.",
      });
    }

    let productNodes = [];

    if (query) {
      // Two-pass search for better relevance:
      // 1. Title/vendor/product_type/tag focused query (high precision)
      // 2. Fall back to broad query (description + everything) if too few results
      const tokens = query.split(/\s+/).filter((t) => t.length > 1);
      const fieldClauses = tokens.flatMap((t) => [
        `title:*${t}*`,
        `vendor:*${t}*`,
        `product_type:*${t}*`,
        `tag:${t}`,
      ]);
      const focusedQuery = `status:active AND (${fieldClauses.join(" OR ")})`;
      const broadQuery = `status:active ${query}`;

      try {
        const data = await shopifyGraphQL(PRODUCT_SEARCH_QUERY, { query: focusedQuery });
        productNodes = (data.products?.edges || []).map((e) => e.node);
      } catch (err) {
        // If the focused query syntax fails, fall through to broad
        console.warn("Focused search failed, falling back to broad:", err.message);
      }

      if (productNodes.length < 3) {
        const data = await shopifyGraphQL(PRODUCT_SEARCH_QUERY, { query: broadQuery });
        const broadNodes = (data.products?.edges || []).map((e) => e.node);
        // Merge, dedupe by handle, keep focused-query order first
        const seen = new Set(productNodes.map((p) => p.handle));
        for (const n of broadNodes) {
          if (!seen.has(n.handle)) {
            productNodes.push(n);
            seen.add(n.handle);
          }
        }
      }

      // Drop products from currently-unavailable brands
      productNodes = productNodes.filter((p) => {
        const vendor = (p.vendor || "").toLowerCase().replace(/[\s-]/g, "");
        return !UNAVAILABLE_BRANDS.some((b) => vendor.includes(b.replace(/[\s-]/g, "")));
      });
    } else if (collection) {
      const data = await shopifyGraphQL(COLLECTION_SEARCH_QUERY, { handle: collection });
      productNodes = (data.collectionByHandle?.products?.edges || []).map((e) => e.node);
      productNodes = productNodes.filter((p) => {
        const vendor = (p.vendor || "").toLowerCase().replace(/[\s-]/g, "");
        return !UNAVAILABLE_BRANDS.some((b) => vendor.includes(b.replace(/[\s-]/g, "")));
      });
    }

    if (productNodes.length === 0) {
      return res.status(200).json({
        found: false,
        message: `No products found matching "${query || collection}". Try a different search term.`,
      });
    }

    const storeUrl = "https://paintaccess.com.au";

    const results = productNodes.map((p) => {
      const variants = (p.variants?.edges || []).map((e) => {
        const tracked = e.node.inventoryItem?.tracked !== false;
        const policy = e.node.inventoryPolicy || "DENY";
        const qty = e.node.inventoryQuantity ?? 0;
        const available = !tracked || policy === "CONTINUE" || qty > 0;
        return {
          title: e.node.title,
          price: e.node.price,
          sku: e.node.sku,
          available,
          inventory_quantity: qty,
          inventory_policy: policy,
          sell_when_out_of_stock: policy === "CONTINUE",
        };
      });

      const prices = variants.map((v) => parseFloat(v.price)).filter((n) => !isNaN(n));

      return {
        name: p.title,
        title: p.title,
        url: `${storeUrl}/products/${p.handle}`,
        vendor: p.vendor,
        product_type: p.productType,
        price_range: {
          min: prices.length > 0 ? Math.min(...prices) : 0,
          max: prices.length > 0 ? Math.max(...prices) : 0,
        },
        price: prices.length > 0
          ? (Math.min(...prices) === Math.max(...prices)
              ? `$${Math.min(...prices).toFixed(2)} AUD`
              : `$${Math.min(...prices).toFixed(2)}–$${Math.max(...prices).toFixed(2)} AUD`)
          : null,
        available: variants.some((v) => v.available),
        variants,
        image: p.featuredImage?.url || null,
      };
    });

    return res.status(200).json({
      found: true,
      summary: {
        total: results.length,
        in_stock: results.filter((p) => p.available).length,
        out_of_stock: results.filter((p) => !p.available).length,
      },
      products: results.slice(0, 15),
    });
  } catch (err) {
    console.error("Product search error:", err);
    return res.status(500).json({ error: "Failed to search products." });
  }
};
