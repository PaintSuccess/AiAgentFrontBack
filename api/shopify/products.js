const {
  shopifyGraphQL,
  verifyAuth,
  corsHeaders,
  rateLimit,
  sanitizeInput,
} = require("../../lib/shopify");

// ── Tunables ─────────────────────────────────────────────────────────────────
const CANDIDATE_POOL = 50;   // products fetched from Shopify per search call
const RESULT_LIMIT = 15;     // products returned to the caller
const STORE_URL = "https://paintaccess.com.au";

// Words to drop from natural-language input ("I need a brush" → "brush")
const STOP_WORDS = new Set([
  "i", "im", "me", "my", "we", "you", "your", "a", "an", "the", "of", "for",
  "and", "or", "to", "in", "on", "at", "is", "are", "be", "do", "does", "did",
  "have", "has", "want", "need", "looking", "look", "show", "give", "tell",
  "please", "thanks", "hello", "hi", "hey", "some", "any", "this", "that",
  "these", "those", "what", "which", "where", "best", "good", "buy", "get",
  "find", "search", "with", "without", "about",
]);

// Detect Shopify SKU/style codes like "16W120", "17M362", "ZSP4"
const SKU_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,}$/i;

// ── GraphQL queries ──────────────────────────────────────────────────────────
const PRODUCT_SEARCH_QUERY = `
  query searchProducts($query: String!, $first: Int!) {
    products(first: $first, query: $query) {
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
                availableForSale
                inventoryQuantity
              }
            }
          }
          featuredImage { url }
        }
      }
    }
  }
`;

const COLLECTION_SEARCH_QUERY = `
  query collectionProducts($handle: String!) {
    collectionByHandle(handle: $handle) {
      products(first: 50) {
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
                  availableForSale
                  inventoryQuantity
                }
              }
            }
            featuredImage { url }
          }
        }
      }
    }
  }
`;

// ── Helpers ──────────────────────────────────────────────────────────────────
function normalizeQuery(raw) {
  return String(raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(normalized) {
  return normalized
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
}

function looksLikeSku(raw) {
  const cleaned = String(raw || "").trim();
  return SKU_PATTERN.test(cleaned) && /\d/.test(cleaned);
}

/**
 * Score a product against the search tokens.
 * Higher = more relevant. Field weights:
 *   title:          10 per token hit, +20 phrase bonus if ALL tokens in title
 *   product_type:    5 per token hit
 *   vendor:          4 per token hit
 *   tags:            3 per token hit
 *   sku (variants):  8 per token hit
 * In-stock products get a small tiebreaker.
 */
function scoreProduct(product, tokens, fullPhrase) {
  if (tokens.length === 0) return 0;
  const title = (product.title || "").toLowerCase();
  const type = (product.productType || "").toLowerCase();
  const vendor = (product.vendor || "").toLowerCase();
  const tags = (product.tags || []).map((t) => String(t).toLowerCase());
  const variantSkus = (product.variants?.edges || [])
    .map((e) => (e.node.sku || "").toLowerCase())
    .filter(Boolean);

  let score = 0;
  let tokensInTitle = 0;

  for (const tok of tokens) {
    if (title.includes(tok)) { score += 10; tokensInTitle += 1; }
    if (type.includes(tok)) score += 5;
    if (vendor.includes(tok)) score += 4;
    if (tags.some((t) => t.includes(tok))) score += 3;
    if (variantSkus.some((s) => s.includes(tok))) score += 8;
  }

  // All tokens land in title
  if (tokens.length > 1 && tokensInTitle === tokens.length) score += 20;
  // Contiguous phrase in title (e.g. "angle sash brush")
  if (tokens.length > 1 && title.includes(tokens.join(" "))) score += 15;
  // Full normalized phrase in title
  if (fullPhrase && title.includes(fullPhrase)) score += 10;

  // In-stock tiebreaker
  const anyAvailable = (product.variants?.edges || []).some(
    (e) => e.node.availableForSale === true,
  );
  if (anyAvailable) score += 1;

  return score;
}

function shapeProduct(p) {
  const variants = (p.variants?.edges || []).map((e) => ({
    title: e.node.title,
    price: e.node.price,
    sku: e.node.sku,
    available: e.node.availableForSale === true,
    inventory_quantity: e.node.inventoryQuantity ?? null,
  }));

  const prices = variants
    .map((v) => parseFloat(v.price))
    .filter((n) => Number.isFinite(n));
  const minP = prices.length ? Math.min(...prices) : null;
  const maxP = prices.length ? Math.max(...prices) : null;

  return {
    name: p.title,
    title: p.title,
    url: `${STORE_URL}/products/${p.handle}`,
    vendor: p.vendor || null,
    product_type: p.productType || null,
    price_range: minP != null ? { min: minP, max: maxP } : null,
    price:
      minP == null
        ? null
        : minP === maxP
          ? `$${minP.toFixed(2)} AUD`
          : `$${minP.toFixed(2)}–$${maxP.toFixed(2)} AUD`,
    available: variants.some((v) => v.available),
    variants,
    image: p.featuredImage?.url || null,
  };
}

// ── Search strategies ────────────────────────────────────────────────────────
async function fetchPool(shopifyQuery) {
  const data = await shopifyGraphQL(PRODUCT_SEARCH_QUERY, {
    query: shopifyQuery,
    first: CANDIDATE_POOL,
  });
  return (data.products?.edges || []).map((e) => e.node);
}

/**
 * Strategy:
 *   1. SKU-shaped input? Try sku: lookup first.
 *   2. Broad fulltext using normalized query (Shopify's default ranker).
 *   3. If pool too small, run each token individually and union.
 *   4. Score client-side and return ranked candidates.
 */
async function searchProducts(rawQuery) {
  const normalized = normalizeQuery(rawQuery);
  const tokens = tokenize(normalized);
  const usableQuery = tokens.length ? tokens.join(" ") : normalized;

  const seen = new Map(); // handle → node
  const add = (nodes) => {
    for (const n of nodes) {
      if (n.status && n.status !== "ACTIVE") continue;
      if (!seen.has(n.handle)) seen.set(n.handle, n);
    }
  };

  // 1. SKU shortcut
  if (looksLikeSku(rawQuery)) {
    const skuToken = String(rawQuery).trim();
    try { add(await fetchPool(`status:active sku:${skuToken}`)); }
    catch (_) { /* fall through */ }
  }

  // 2. Primary broad search
  if (seen.size < CANDIDATE_POOL) {
    try { add(await fetchPool(`status:active ${usableQuery || normalized || rawQuery}`)); }
    catch (_) { /* fall through */ }
  }

  // 3. Token-by-token fallback
  if (seen.size < 5 && tokens.length > 1) {
    for (const tok of tokens) {
      if (seen.size >= CANDIDATE_POOL) break;
      try { add(await fetchPool(`status:active ${tok}`)); }
      catch (_) { /* keep going */ }
    }
  }

  const pool = Array.from(seen.values());
  if (pool.length === 0) return { products: [], tokens };

  const fullPhrase = tokens.join(" ");
  const scored = pool
    .map((p) => ({ p, score: scoreProduct(p, tokens, fullPhrase) }))
    .sort((a, b) => b.score - a.score);

  return { products: scored.map(({ p }) => p), tokens };
}

async function searchByCollection(handle) {
  const data = await shopifyGraphQL(COLLECTION_SEARCH_QUERY, { handle });
  return (data.collectionByHandle?.products?.edges || []).map((e) => e.node);
}

// ── Handler ──────────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  corsHeaders(res, req);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (rateLimit(req, res)) return;
  if (!verifyAuth(req)) return res.status(401).json({ error: "Unauthorized" });

  try {
    const params = req.method === "POST" ? req.body || {} : req.query;
    const query = sanitizeInput(params.query);
    const collection = sanitizeInput(params.collection, 100);

    if (!query && !collection) {
      return res.status(400).json({
        error: "Please provide a search query or collection handle.",
      });
    }

    let pool = [];
    let tokens = [];
    if (query) {
      const result = await searchProducts(query);
      pool = result.products;
      tokens = result.tokens;
    } else {
      pool = await searchByCollection(collection);
    }

    if (pool.length === 0) {
      return res.status(200).json({
        found: false,
        query: query || null,
        collection: collection || null,
        tokens,
        message: `No products found matching "${query || collection}". Try a broader or different term.`,
      });
    }

    const shaped = pool.slice(0, RESULT_LIMIT).map(shapeProduct);

    return res.status(200).json({
      found: true,
      query: query || null,
      collection: collection || null,
      tokens,
      summary: {
        total: shaped.length,
        in_stock: shaped.filter((p) => p.available).length,
        out_of_stock: shaped.filter((p) => !p.available).length,
      },
      products: shaped,
    });
  } catch (err) {
    console.error("Product search error:", err);
    return res.status(500).json({ error: "Failed to search products." });
  }
};
