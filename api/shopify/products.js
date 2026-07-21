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
// Keep the response tiny so the LLM (voice agent uses gemini-2.5-flash) can
// ingest + reply quickly. 5 results × ~150B = ~750B JSON instead of 11KB,
// which empirically drops LLM-side latency by several seconds.
const RESULT_LIMIT = 5;      // products returned to the caller
const MAX_FALLBACK_TOKENS = 3; // cap parallel per-token fallback fan-out
const STORE_URL = "https://paintaccess.com.au";
const SEARCH_DEBUG = process.env.PRODUCT_SEARCH_DEBUG === "1";

// Words to drop from natural-language input ("I need a brush" → "brush")
const STOP_WORDS = new Set([
  "i", "im", "am", "me", "my", "we", "you", "your", "a", "an", "the", "of", "for",
  "and", "or", "to", "in", "on", "at", "is", "it", "are", "be", "do", "does", "did",
  "have", "has", "want", "need", "looking", "look", "show", "give", "tell",
  "please", "thanks", "hello", "hi", "hey", "help", "some", "any", "this", "that",
  "these", "those", "what", "which", "where", "best", "good", "buy", "get",
  "find", "search", "with", "without", "about", "product", "products", "link",
  "links", "url", "urls", "can", "could", "would", "should", "send", "grab",
  "also", "same", "other", "only", "not", "just", "codex", "live", "test",
  "interest", "interested", "share", "from", "paint", "access", "paintaccess",
  "whatsapp", "support", "chat", "business",
]);

// Detect Shopify SKU/style codes like "16W120", "17M362", "ZSP4"
const SKU_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,}$/i;
const COMMON_QUERY_VARIANTS = {
  refining: ["refinishing", "refinish"],
  tube: ["tub"],
};

const NON_MERCHANDISE_PATTERNS = [
  /\bpaintaccess[-\s]+vip[-\s]+painters[-\s]+club\b/i,
  /\bvip[-\s]+painters[-\s]+club[-\s]+membership\b/i,
  /\bdaniel[-\s]+dorofeev\b/i,
  /\bjoin[-\s]+vip[-\s]+painters[-\s]+community\b/i,
];

// ── GraphQL queries ──────────────────────────────────────────────────────────
const PRODUCT_SEARCH_QUERY = `
  query searchProducts($query: String!, $first: Int!) {
    products(first: $first, query: $query) {
      edges {
        node {
          title
          handle
          onlineStoreUrl
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
                barcode
                availableForSale
                inventoryQuantity
                inventoryPolicy
                inventoryItem { tracked }
                selectedOptions { name value }
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
            onlineStoreUrl
            vendor
            productType
            tags
            variants(first: 5) {
              edges {
                node {
                  title
                  price
                  sku
                  barcode
                  availableForSale
                  inventoryQuantity
                  inventoryPolicy
                  inventoryItem { tracked }
                  selectedOptions { name value }
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
    .replace(/['’]\s*s\b/g, "s")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(normalized) {
  return normalized
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function expandUnitToken(token) {
  const match = String(token || "").match(/^(\d+(?:\.\d+)?)(mm|cm|m|ml|l|lt|ltr|litre|litres|kg|g)$/i);
  if (!match) return [token];

  const amount = match[1];
  const unit = match[2].toLowerCase();
  const normalizedUnit =
    unit === "lt" || unit === "ltr" || unit === "litre" || unit === "litres"
      ? "l"
      : unit;

  return unique([token, amount, `${amount}${normalizedUnit}`]);
}

function expandTokens(tokens) {
  return unique(tokens.flatMap(expandUnitToken));
}

function tokenVariants(token) {
  const variants = new Set(expandUnitToken(token));
  for (const variant of COMMON_QUERY_VARIANTS[String(token || "").toLowerCase()] || []) {
    variants.add(variant);
  }
  const spaced = String(token || "").match(/^(\d+(?:\.\d+)?)([a-z]+)$/i);
  if (spaced) variants.add(`${spaced[1]} ${spaced[2].toLowerCase()}`);
  return [...variants];
}

function singularToken(token) {
  const value = String(token || "");
  if (value.length <= 4) return value;
  if (value.endsWith("ies")) return `${value.slice(0, -3)}y`;
  if (value.endsWith("es")) return value.slice(0, -2);
  if (value.endsWith("s")) return value.slice(0, -1);
  return value;
}

function variantFields(product) {
  return (product.variants?.edges || []).flatMap((e) => {
    const v = e.node || {};
    return [
      v.title,
      v.sku,
      v.barcode,
      ...(v.selectedOptions || []).flatMap((opt) => [opt.name, opt.value]),
    ];
  });
}

function searchableFields(product) {
  return [
    product.title,
    product.productType,
    product.vendor,
    ...(product.tags || []),
    ...variantFields(product),
  ]
    .map((v) => String(v || "").toLowerCase())
    .filter(Boolean);
}

function isMerchandiseProduct(product) {
  const haystack = [
    product.handle,
    product.title,
    product.productType,
    product.vendor,
    ...(product.tags || []),
  ]
    .map((value) => String(value || ""))
    .join(" ");

  return !NON_MERCHANDISE_PATTERNS.some((pattern) => pattern.test(haystack));
}

function compactField(field) {
  return String(field || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function tokenizeSearchableText(fields) {
  return fields
    .join(" ")
    .replace(/[^a-z0-9.\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

function editDistance(a, b) {
  if (a === b) return 0;
  if (!a || !b) return Math.max(a.length, b.length);
  if (Math.abs(a.length - b.length) > 2) return 3;

  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost
      );
      rowMin = Math.min(rowMin, curr[j]);
    }
    if (rowMin > 2) return 3;
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }

  return prev[b.length];
}

function fuzzyTokenHit(token, fieldTokens) {
  if (token.length < 4) return false;
  const maxDistance = token.length >= 8 ? 3 : token.length >= 6 ? 2 : 1;
  const singular = singularToken(token);
  return fieldTokens.some((fieldToken) => {
    const fieldSingular = singularToken(fieldToken);
    if (fieldSingular.length < 4) return false;
    if (singular[0] !== fieldSingular[0]) return false;
    if (
      Math.abs(singular.length - fieldSingular.length) <= 2 &&
      (singular.startsWith(fieldSingular) || fieldSingular.startsWith(singular))
    ) {
      return true;
    }
    if (singular[singular.length - 1] !== fieldSingular[fieldSingular.length - 1]) return false;
    return editDistance(singular, fieldSingular) <= maxDistance;
  });
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
  const variants = (product.variants?.edges || []).map((e) => e.node || {});
  const variantTitles = variants.map((v) => (v.title || "").toLowerCase()).filter(Boolean);
  const variantCodes = variants
    .flatMap((v) => [v.sku, v.barcode])
    .map((v) => String(v || "").toLowerCase())
    .filter(Boolean);
  const optionValues = variants
    .flatMap((v) => v.selectedOptions || [])
    .flatMap((opt) => [opt.name, opt.value])
    .map((v) => String(v || "").toLowerCase())
    .filter(Boolean);
  const allFields = searchableFields(product);
  const allFieldTokens = tokenizeSearchableText(allFields);
  const expanded = expandTokens(tokens);

  let score = 0;
  let tokensInTitle = 0;
  let tokensInAnyField = 0;

  for (const tok of tokens) {
    const variantsForToken = tokenVariants(tok);
    const titleHit = variantsForToken.some((v) => title.includes(v));
    const typeHit = variantsForToken.some((v) => type.includes(v));
    const vendorHit = variantsForToken.some((v) => vendor.includes(v));
    const tagHit = variantsForToken.some((v) => tags.some((t) => t.includes(v)));
    const variantTitleHit = variantsForToken.some((v) => variantTitles.some((t) => t.includes(v)));
    const codeHit = variantsForToken.some((v) => variantCodes.some((s) => s.includes(v)));
    const optionHit = variantsForToken.some((v) => optionValues.some((s) => s.includes(v)));
    const compactHit = variantsForToken.some((v) => {
      const compactToken = compactField(v);
      return compactToken.length >= 4 && allFields.some((field) => compactField(field).includes(compactToken));
    });
    const fuzzyHit = !titleHit && fuzzyTokenHit(tok, allFieldTokens);

    if (titleHit) { score += 12; tokensInTitle += 1; }
    if (typeHit) score += 5;
    if (vendorHit) score += 4;
    if (tagHit) score += 3;
    if (variantTitleHit) score += 6;
    if (codeHit) score += 10;
    if (optionHit) score += 4;
    if (compactHit) score += 3;
    if (fuzzyHit) score += 3;
    if (titleHit || typeHit || vendorHit || tagHit || variantTitleHit || codeHit || optionHit || compactHit || fuzzyHit) {
      tokensInAnyField += 1;
    }
  }

  // All tokens land in title
  if (tokens.length > 1 && tokensInTitle === tokens.length) score += 24;
  if (tokens.length > 1 && tokensInAnyField === tokens.length) score += 12;
  if (tokens.length === 2 && tokensInAnyField < 2) return 0;
  if (tokens.length >= 3 && tokensInAnyField < 2) return 0;
  // Contiguous phrase in title (e.g. "angle sash brush")
  if (tokens.length > 1 && title.includes(tokens.join(" "))) score += 18;
  // Full normalized phrase in title
  if (fullPhrase && title.includes(fullPhrase)) score += 10;
  if (expanded.length > tokens.length && expanded.every((tok) => allFields.some((field) => field.includes(tok)))) {
    score += 8;
  }

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
  // Compute availability + price range from variants but DO NOT include the
  // full variants array in the response — voice-agent LLM only needs a
  // compact summary it can speak back.  See inventoryPolicy comment in
  // scoreProduct() for the availability discriminator rationale.
  const variants = (p.variants?.edges || []).map((e) => e.node);
  const anyAvailable = variants.some((v) => {
    const tracked = v.inventoryItem?.tracked === true;
    return tracked
      ? v.inventoryPolicy === 'CONTINUE'
      : v.availableForSale === true;
  });

  const prices = variants
    .map((v) => parseFloat(v.price))
    .filter((n) => Number.isFinite(n));
  const minP = prices.length ? Math.min(...prices) : null;
  const maxP = prices.length ? Math.max(...prices) : null;

  return {
    name: p.title,
    url: p.onlineStoreUrl || `${STORE_URL}/products/${p.handle}`,
    vendor: p.vendor || null,
    price:
      minP == null
        ? null
        : minP === maxP
          ? `$${minP.toFixed(2)} AUD`
          : `$${minP.toFixed(2)}–$${maxP.toFixed(2)} AUD`,
    available: anyAvailable,
  };
}

function displayPayload(products, queryOrCollection) {
  const productCards = products.map((product) => ({
    name: product.name,
    url: product.url,
    price: product.price,
    note:
      product.available === true
        ? "In stock"
        : product.available === false
          ? "Currently unavailable"
          : undefined,
  }));

  return {
    intro: `Found ${productCards.length} product${productCards.length === 1 ? "" : "s"} for ${queryOrCollection}:`,
    products: productCards,
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

function buildSearchQueries(rawQuery, tokens, normalized) {
  const base = tokens.length ? tokens.join(" ") : normalized || rawQuery;
  const queries = [`status:active ${base}`];

  const unitRelaxed = tokens
    .map((tok) => {
      const match = tok.match(/^(\d+(?:\.\d+)?)(mm|cm|m|ml|l|lt|ltr|litre|litres|kg|g)$/i);
      return match ? match[1] : tok;
    })
    .join(" ");

  if (unitRelaxed && unitRelaxed !== base) {
    queries.push(`status:active ${unitRelaxed}`);
  }

  const dehyphenated = base.replace(/-/g, " ");
  if (dehyphenated && dehyphenated !== base) {
    queries.push(`status:active ${dehyphenated}`);
  }

  return unique(queries);
}

/**
 * Strategy:
 *   1. SKU-shaped input? Try sku: lookup first.
 *   2. Broad fulltext using normalized query (Shopify's default ranker).
 *   3. If pool too small OR some tokens are "orphaned" (match nothing in the
 *      pool — a sign of voice STT artefacts like "stratismen" for "tradesman"),
 *      re-run with only the tokens that actually appeared in at least one result.
 *   4. Per-token fallback for very sparse pools.
 *   5. Score client-side and return ranked candidates.
 *
 * The orphaned-token step (3) is the key fix for voice: ElevenLabs STT
 * frequently mutates brand/product names that it doesn't recognise.  When a
 * token matches zero products in the pool the Shopify ranker effectively
 * ignores it anyway — but our client-side scorer then promotes unrelated
 * results because no product earns the token weight.  By stripping such tokens
 * and re-querying we get the product the customer actually said.
 */
async function searchProducts(rawQuery) {
  const normalized = normalizeQuery(rawQuery);
  const tokens = tokenize(normalized);
  const expandedTokens = expandTokens(tokens);
  const strategies = [];

  if (!tokens.length && !looksLikeSku(rawQuery)) {
    return { products: [], tokens, expandedTokens, strategies };
  }

  const seen = new Map(); // handle → node
  const add = (nodes) => {
    for (const n of nodes) {
      if (n.status && n.status !== "ACTIVE") continue;
      if (!n.onlineStoreUrl) continue;
      if (!isMerchandiseProduct(n)) continue;
      if (!seen.has(n.handle)) seen.set(n.handle, n);
    }
  };
  const safeFetch = (q) => fetchPool(q).catch(() => []);

  // 1+2. Run SKU lookup (if applicable), primary broad search, and safe
  // normalized variants in parallel. The variants are generic: unit relaxation
  // ("175mm" -> "175") and punctuation cleanup, never brand/product hardcodes.
  const primaryQueries = buildSearchQueries(rawQuery, tokens, normalized);
  strategies.push(...primaryQueries);
  const initial = primaryQueries.map((q) => safeFetch(q));
  if (looksLikeSku(rawQuery)) {
    const skuQ = `status:active sku:${String(rawQuery).trim()}`;
    strategies.push(skuQ);
    initial.unshift(safeFetch(skuQ));
  }
  for (const nodes of await Promise.all(initial)) add(nodes);

  // 3. STT artefact recovery:
  //    Case A — primary returned products but a token appears in NONE of them
  //              (token is an invented word; re-run with only matched tokens).
  //    Case B — primary returned 0 (Shopify strict-AND killed the query because
  //              one token is total nonsense); try ALL n-1 token combinations in
  //              parallel — one of them omits the bad token and finds real results.
  //    Both cases are typical when ElevenLabs STT mishears a product name,
  //    e.g. "Tradesman" -> "Stratismen".
  if (tokens.length > 1) {
    if (seen.size === 0) {
      // Case B: primary returned nothing — try dropping each token once.
      const nMinus1Queries = tokens.map((_, i) =>
        tokens.filter((_, j) => j !== i).join(" ")
      );
      strategies.push(...nMinus1Queries.map((q) => `status:active ${q}`));
      const results = await Promise.all(
        nMinus1Queries.map((q) => safeFetch(`status:active ${q}`))
      );
      for (const nodes of results) add(nodes);
    } else {
      // Case A: primary had results — check which tokens appear in none of them.
      const pool0 = Array.from(seen.values());
      const matchedTokens = tokens.filter((tok) =>
        pool0.some(
          (p) => tokenVariants(tok).some((variant) =>
            searchableFields(p).some((field) => field.includes(variant))
          )
        )
      );
      if (matchedTokens.length > 0 && matchedTokens.length < tokens.length) {
        strategies.push(`status:active ${matchedTokens.join(" ")}`);
        const cleanNodes = await safeFetch(`status:active ${matchedTokens.join(" ")}`);
        add(cleanNodes);
      }
    }
  }

  // 4. Per-token fallback: when the pool is still sparse after primary search
  // + STT artefact recovery.  Fire up to MAX_FALLBACK_TOKENS in parallel.
  if (seen.size < 10 && tokens.length > 1) {
    const picks = tokens.slice(0, MAX_FALLBACK_TOKENS);
    strategies.push(...picks.map((tok) => `status:active ${tok}`));
    const results = await Promise.all(picks.map((tok) => safeFetch(`status:active ${tok}`)));
    for (const nodes of results) add(nodes);
  }

  const pool = Array.from(seen.values());
  if (pool.length === 0) return { products: [], tokens, expandedTokens, strategies };

  const scoringTokens =
    tokens.length > 1
      ? tokens.filter((tok) => pool.some((p) => scoreProduct(p, [tok], tok) > 0))
      : tokens;
  const activeTokens = scoringTokens.length ? scoringTokens : tokens;
  const fullPhrase = activeTokens.join(" ");
  const scored = pool
    .map((p) => ({ p, score: scoreProduct(p, activeTokens, fullPhrase) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return { products: [], tokens, expandedTokens, strategies };
  }

  if (SEARCH_DEBUG) {
    console.info("[ProductSearch]", {
      query: rawQuery,
      tokens,
      expandedTokens,
      strategies: unique(strategies),
      candidates: pool.length,
      top: scored.slice(0, RESULT_LIMIT).map(({ p, score }) => ({
        handle: p.handle,
        title: p.title,
        score,
      })),
    });
  }

  return { products: scored.map(({ p }) => p), tokens, expandedTokens, strategies };
}

async function searchByCollection(handle) {
  const data = await shopifyGraphQL(COLLECTION_SEARCH_QUERY, { handle });
  return (data.collectionByHandle?.products?.edges || [])
    .map((e) => e.node)
    .filter((p) => p.onlineStoreUrl && isMerchandiseProduct(p));
}

// ── Handler ──────────────────────────────────────────────────────────────────
async function handler(req, res) {
  corsHeaders(res, req);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (await rateLimit(req, res)) return;
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
    let expandedTokens = [];
    let strategies = [];
    if (query) {
      const result = await searchProducts(query);
      pool = result.products;
      tokens = result.tokens;
      expandedTokens = result.expandedTokens || [];
      strategies = result.strategies || [];
    } else {
      pool = await searchByCollection(collection);
    }

    if (pool.length === 0) {
      if (SEARCH_DEBUG) {
        console.info("[ProductSearch] no results", {
          query,
          collection,
          tokens,
          expandedTokens,
          strategies: unique(strategies),
        });
      }

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
      // Channel-specific so the model is never told to think about a "screen" on a
      // phone call. Previously this only named "website widget or browser voice mode"
      // and "SMS or WhatsApp" — a real PHONE call matched neither, and the phrase
      // "browser voice mode ... on the customer's screen" led the agent to say
      // "I've put the details on your screen" on a voice call with no screen (audit
      // conv_5201, 2026-07-18). Each channel now has an explicit instruction.
      next_action_required:
        "Pick your next step by channel. WEBSITE WIDGET (channel is website_widget, or display_products_available is 'true'): your immediate next tool call MUST be display_products_in_chat using display_products_in_chat_payload — do this before you speak any product details or say anything is on their screen. PHONE CALL (channel is phone): there is NO screen — never say anything is 'on your screen' or 'on the screen', and do NOT call display_products_in_chat; instead say the top two or three product names with their prices out loud, then offer to text the links. SMS or WhatsApp: do NOT call display_products_in_chat; include concise product links in the text reply instead.",
      display_products_in_chat_payload: displayPayload(shaped, query || collection),
      summary: {
        total: shaped.length,
        in_stock: shaped.filter((p) => p.available).length,
      },
      products: shaped,
    });
  } catch (err) {
    console.error("Product search error:", err);
    return res.status(500).json({ error: "Failed to search products." });
  }
}

module.exports = handler;
module.exports.searchProducts = searchProducts;
module.exports.searchByCollection = searchByCollection;
module.exports.shapeProduct = shapeProduct;
module.exports.RESULT_LIMIT = RESULT_LIMIT;
