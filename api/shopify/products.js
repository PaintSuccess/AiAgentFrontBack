const {
  shopifyGraphQL,
  verifyAuth,
  corsHeaders,
  rateLimit,
  sanitizeInput,
} = require("../../lib/shopify");

// ── Tunables ─────────────────────────────────────────────────────────────────
// Smaller pool = faster Shopify response (and smaller GraphQL payload).
// 25 still leaves enough headroom for client-side scoring on broad queries.
const CANDIDATE_POOL = 25;   // products fetched from Shopify per search call
const RESULT_LIMIT = 15;     // products returned to the caller
const MAX_FALLBACK_TOKENS = 3; // cap parallel per-token fallback fan-out
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
          variants(first: 5) {
            edges {
              node {
                title
                price
                sku
                availableForSale
                inventoryQuantity
                inventoryPolicy
                inventoryItem { tracked }
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
            variants(first: 5) {
              edges {
                node {
                  title
                  price
                  sku
                  availableForSale
                  inventoryQuantity
                  inventoryPolicy
                  inventoryItem { tracked }
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
  // This store's online fulfillment location always has 0 qty for ALL products —
  // stock lives in a warehouse location not linked to the online store channel.
  // For tracked variants the only reliable availability signal is inventoryPolicy:
  //   CONTINUE = oversell allowed → customer can add to cart regardless of qty
  //   DENY     = out of stock on storefront (online location is always 0)
  // Untracked variants have no location-specific stock, so trust Admin API.
  const anyAvailable = (product.variants?.edges || []).some((e) => {
    const v = e.node;
    const tracked = v.inventoryItem?.tracked === true;
    return tracked
      ? v.inventoryPolicy === 'CONTINUE'
      : v.availableForSale === true;
  });
  if (anyAvailable) score += 1;

  return score;
}

function shapeProduct(p) {
  const variants = (p.variants?.edges || []).map((e) => {
    const v = e.node;
    // Availability: this store's online fulfillment location always carries 0 qty —
    // warehouse stock (at a separate location) is NOT linked to the online channel.
    // Admin API availableForSale aggregates ALL locations and is unreliable for
    // DENY-policy products.  inventoryPolicy is the correct discriminator:
    //   CONTINUE = customer CAN order regardless of qty (Add to cart on storefront)
    //   DENY     = storefront shows "Out of stock" / "Notify me" (online qty always 0)
    // For untracked variants there is no location-specific stock, so trust Admin API.
    const tracked = v.inventoryItem?.tracked === true;
    const available = tracked
      ? v.inventoryPolicy === 'CONTINUE'
      : v.availableForSale === true;
    return {
      title: v.title,
      price: v.price,
      sku: v.sku,
      available,
      inventory_quantity: v.inventoryQuantity ?? null,
    };
  });

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
  const safeFetch = (q) => fetchPool(q).catch(() => []);

  // 1+2. Run SKU lookup (if applicable) and the primary broad search in
  // parallel. The SKU shortcut is independent of the broad query, so there's
  // no benefit to chaining them — fire both at once and merge.
  const primaryQ = `status:active ${usableQuery || normalized || rawQuery}`;
  const initial = [safeFetch(primaryQ)];
  if (looksLikeSku(rawQuery)) {
    initial.unshift(safeFetch(`status:active sku:${String(rawQuery).trim()}`));
  }
  for (const nodes of await Promise.all(initial)) add(nodes);

  // 3. Per-token fallback: only when the primary search returned almost
  // nothing. Fire up to MAX_FALLBACK_TOKENS in parallel rather than one at a
  // time — this is the strategy that previously dominated tail latency.
  if (seen.size < 5 && tokens.length > 1) {
    const picks = tokens.slice(0, MAX_FALLBACK_TOKENS);
    const results = await Promise.all(picks.map((tok) => safeFetch(`status:active ${tok}`)));
    for (const nodes of results) add(nodes);
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
