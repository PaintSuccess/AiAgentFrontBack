const { shopifyGraphQL, verifyAuth, corsHeaders } = require("../../lib/shopify");

const PRODUCT_SEARCH_QUERY = `
  query searchProducts($query: String!) {
    products(first: 10, query: $query) {
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

    let productNodes = [];

    if (query) {
      // Full-text search via GraphQL — searches title, description, vendor, tags, etc.
      const searchQuery = `status:active ${query}`;
      const data = await shopifyGraphQL(PRODUCT_SEARCH_QUERY, { query: searchQuery });
      productNodes = (data.products?.edges || []).map((e) => e.node);
    } else if (collection) {
      const data = await shopifyGraphQL(COLLECTION_SEARCH_QUERY, { handle: collection });
      productNodes = (data.collectionByHandle?.products?.edges || []).map((e) => e.node);
    }

    if (productNodes.length === 0) {
      return res.status(200).json({
        found: false,
        message: `No products found matching "${query || collection}". Try a different search term.`,
      });
    }

    const storeUrl = "https://paintaccess.com.au";

    const results = productNodes.map((p) => {
      const variants = (p.variants?.edges || []).map((e) => ({
        title: e.node.title,
        price: e.node.price,
        sku: e.node.sku,
        available: e.node.inventoryQuantity > 0,
        inventory_quantity: e.node.inventoryQuantity,
      }));

      const prices = variants.map((v) => parseFloat(v.price)).filter((n) => !isNaN(n));

      return {
        title: p.title,
        url: `${storeUrl}/products/${p.handle}`,
        vendor: p.vendor,
        product_type: p.productType,
        price_range: {
          min: prices.length > 0 ? Math.min(...prices) : 0,
          max: prices.length > 0 ? Math.max(...prices) : 0,
        },
        available: variants.some((v) => v.available),
        variants,
        image: p.featuredImage?.url || null,
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
