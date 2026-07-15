const { cleanEnv } = require("./shopify");
const productSearchApi = require("../api/shopify/products");
const {
  extractEmail,
  extractOrderNumber,
  looksLikeOrderIntent,
  lookupCustomerOrder,
} = require("./customer-order-lookup");

const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";
// Twilio's messaging webhook gives up and retries around 15s. If our own timeout is
// longer than that, a slow turn gets processed twice: once when Twilio retries the
// webhook, and again when this timeout eventually fires — producing duplicate replies
// to the customer. Keep this comfortably under that window.
const DEFAULT_TIMEOUT_MS = 11000;
const NORMAL_REPLY_SETTLE_MS = 1400;
const TOOL_REPLY_SETTLE_MS = 6500;
const PRODUCT_URL_RE = /https?:\/\/(?:www\.)?paintaccess\.com\.au\/products\/[^\s)\]]+/i;
const DIRECT_SEARCH_STOP_WORDS = new Set([
  "can", "could", "would", "please", "pls", "get", "send", "show", "grab",
  "give", "need", "want", "find", "look", "looking", "link", "links", "url",
  "urls", "product", "products", "one", "too", "also", "same", "other", "that",
  "this", "for", "with", "without", "about", "the", "and", "or", "are", "you",
  "your", "me", "my", "i", "im", "a", "an", "to", "of", "in", "on", "it", "from",
  "hi", "hello", "hey", "here", "there", "help", "red", "black", "white",
  "blue", "green", "yellow", "clear", "only", "not", "just", "codex",
  "live", "test", "interest", "interested", "share", "paint", "access",
  "paintaccess", "whatsapp", "support", "chat", "business", "yeah", "yes",
  "yep", "sure", "suggestion", "suggestions", "recommend", "recommendation",
  "recommendations", "suggest", "suuggestion", "buy", "purchase", "could",
  "asked", "ask",
]);
const PRODUCT_FOLLOWUP_RE =
  /\b(link|links|url|send|get|grab|black|white|red|blue|that one|this one|same one|other one|one too|wheeled|backpack|compact|cart|sprayers?|brush(?:es)?|cutter|oval|kit)\b/i;
const PRODUCT_KEYWORD_RE =
  /\b(link|links|url|urls|product|products|recommend|recommendation|price|stock|available|buy|sprayers?|paints?|kit|coating|roller|sander|primer|tape|brush(?:es)?|cutter|oval|graco|dan|dans|rust|oleum|wagner|masking|floor|epoxy)\b/i;

async function getSignedUrl(agentId, apiKey) {
  const url = `${ELEVENLABS_BASE}/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`;
  const response = await fetch(url, {
    headers: { "xi-api-key": apiKey },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`ElevenLabs signed URL failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  if (!data.signed_url) {
    throw new Error("ElevenLabs signed URL response did not include signed_url");
  }

  return data.signed_url;
}

function getWebSocketCtor() {
  if (typeof WebSocket === "function") return WebSocket;

  try {
    return require("ws");
  } catch {
    throw new Error("No WebSocket implementation available");
  }
}

function sendJson(ws, payload) {
  ws.send(JSON.stringify(payload));
}

function parseToolParams(call = {}) {
  const raw =
    call.parameters ||
    call.arguments ||
    call.input ||
    call.params ||
    call.request_body ||
    {};

  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  return raw && typeof raw === "object" ? raw : {};
}

async function runTextChannelTool(call = {}) {
  const toolName = call.tool_name || call.name || "";
  const params = parseToolParams(call);

  if (toolName === "search_products") {
    const query = String(params.query || params.product_name || "").trim();
    const collection = String(params.collection || "").trim();

    let pool = [];
    if (query) {
      pool = (await productSearchApi.searchProducts(query)).products || [];
    } else if (collection) {
      pool = await productSearchApi.searchByCollection(collection);
    }

    if (!pool.length) {
      return {
        found: false,
        query: query || null,
        collection: collection || null,
        message: `No products found matching "${query || collection}".`,
      };
    }

    const products = pool
      .slice(0, productSearchApi.RESULT_LIMIT || 5)
      .map(productSearchApi.shapeProduct);

    return {
      found: true,
      query: query || null,
      collection: collection || null,
      summary: {
        total: products.length,
        in_stock: products.filter((p) => p.available).length,
      },
      products,
    };
  }

  if (toolName === "display_products_in_chat") {
    return "SMS has no product-card UI. Include a very short product summary and direct links in the text reply.";
  }

  if (toolName === "send_sms_notification") {
    return "Do not send a separate SMS from SMS or WhatsApp channels. Reply directly in the current text channel with the requested product links or details.";
  }

  if (toolName === "end_conversation" || toolName === "end_call") {
    return "Conversation ending.";
  }

  return "Client-side browser tool is not available in SMS or WhatsApp.";
}

function compactReply(text) {
  return String(text || "")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 1500);
}

function normalizeTextMessageLinks(text) {
  return String(text || "")
    .replace(
    /\[([^\]]{1,120})\]\((https?:\/\/(?:www\.)?paintaccess\.com\.au\/products\/[^)\s]+)\)/gi,
    "$1: $2"
    )
    .replace(
      /https?:\/\/paintaccess\.com\.au\/products\//gi,
      "https://www.paintaccess.com.au/products/"
    )
    .replace(
      /(https:\/\/www\.paintaccess\.com\.au\/products\/[A-Za-z0-9_-]+)[.,;:!?]+(?=\s|$)/g,
      "$1"
    );
}

function mentionsWebsiteProductUi(text) {
  const normalized = String(text || "").toLowerCase();
  return (
    normalized.includes("on your screen") ||
    normalized.includes("product card") ||
    normalized.includes("product popup") ||
    normalized.includes("in the popup") ||
    normalized.includes("displayed")
  );
}

function looksLikeToolPreface(text) {
  const normalized = String(text || "").toLowerCase();
  return (
    /\b(let me|i'?ll|i will|just|no worries).{0,80}\b(search|check|look up|find|confirm|grab|get|send).{0,30}\b(link|links|that|it|products?|stock)?\b/.test(normalized) ||
    /\b(searching|checking|looking that up|checking our stock|grabbing that link|getting that link)\b/.test(normalized)
  );
}

function formatProductSummaryFromToolResult(value) {
  if (!value) return "";

  let payload = value;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      return "";
    }
  }

  const products = Array.isArray(payload?.products) ? payload.products : [];
  if (!products.length) return "";

  const lines = products.slice(0, 3).map((p, i) => {
    const name = p.name || p.title || "Product";
    const price = p.price ? ` - ${p.price}` : "";
    const stock = p.available === true ? " - in stock" : p.available === false ? " - not showing in stock" : "";
    const url = p.url ? `\n${p.url}` : "";
    return `${i + 1}. ${name}${price}${stock}${url}`;
  });

  return compactReply(`I found these options:\n${lines.join("\n")}`);
}

function productAvailabilityNote(productToolResult) {
  const products = Array.isArray(productToolResult?.products) ? productToolResult.products : [];
  if (!products.length) return "";

  const unavailable = products.filter((p) => p.available === false).length;
  const available = products.filter((p) => p.available === true).length;

  if (unavailable && !available) {
    return "Stock note: these listed products are currently unavailable online. Contact Paint Access to confirm restock timing or alternatives.";
  }

  if (unavailable && available) {
    return "Stock note: some listed products are currently unavailable online; check each product page or contact Paint Access before ordering.";
  }

  return "";
}

function allProductsUnavailable(productToolResult) {
  const products = Array.isArray(productToolResult?.products) ? productToolResult.products : [];
  return products.length > 0 && products.every((p) => p.available === false);
}

function normalizeProductKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/['’]\s*s\b/g, "s")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function directSearchTokens(text) {
  return normalizeProductKey(text)
    .split(/\s+/)
    .filter((token) => token.length > 1 && !DIRECT_SEARCH_STOP_WORDS.has(token));
}

function looksLikeDirectProductRequest(text) {
  const normalized = String(text || "").toLowerCase();
  const tokens = directSearchTokens(text);

  if (
    /\b(hi|hello|hey)\b/.test(normalized) &&
    /\b(paint\s*access|paintaccess|whatsapp support chat|support chat)\b/.test(normalized) &&
    tokens.length === 0
  ) {
    return false;
  }

  if (PRODUCT_KEYWORD_RE.test(normalized)) {
    return true;
  }

  return (
    /\b(get|find|looking|need|want|show|send|grab)\b/i.test(normalized) &&
    tokens.length >= 2
  );
}

function compactProductQuery(text) {
  const tokens = directSearchTokens(text);
  return tokens.join(" ").trim();
}

function extractProductQueryCandidates(text) {
  const normalized = String(text || "")
    .replace(/\b(?:and\s+also|also|plus|as well as)\b/gi, "\n")
    .replace(/\b(?:i\s+i|i)\b/gi, " i ");

  const candidates = [];
  for (const part of normalized.split(/\r?\n|[?!.;]+/)) {
    const raw = part.trim();
    if (!raw) continue;
    if (!looksLikeDirectProductRequest(raw)) continue;

    const query = compactProductQuery(raw);
    if (!query) continue;
    candidates.push({ query, source: raw });
  }

  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = normalizeProductKey(candidate.query);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 4);
}

function tokenMatchesName(token, productName) {
  if (!token || !productName) return false;
  if (productName.includes(token)) return true;
  if (token.endsWith("s") && token.length > 3) {
    return productName.includes(token.slice(0, -1));
  }
  return false;
}

function productResultMatchesText(text, productToolResult) {
  const products = Array.isArray(productToolResult?.products) ? productToolResult.products : [];
  const tokens = directSearchTokens(text);
  if (!products.length || !tokens.length) return false;

  const productNames = products
    .slice(0, 3)
    .map((p) => normalizeProductKey(`${p.name || ""} ${p.vendor || ""}`))
    .join(" ");
  const matches = tokens.filter((token) => tokenMatchesName(token, productNames));
  return matches.length >= Math.min(2, tokens.length);
}

async function inferProductToolResultFromDirectRequest(text) {
  if (!looksLikeDirectProductRequest(text)) return null;

  const candidates = extractProductQueryCandidates(text);
  if (!candidates.length) return null;

  try {
    const perQueryLimit = candidates.length > 1 ? 2 : productSearchApi.RESULT_LIMIT || 5;
    const results = await Promise.all(
      candidates.map(async (candidate) => {
        const result = await productSearchApi.searchProducts(candidate.query);
        return {
          query: candidate.query,
          products: (result.products || [])
            .slice(0, perQueryLimit)
            .map((product) => ({
              ...productSearchApi.shapeProduct(product),
              requestedQuery: candidate.query,
            })),
        };
      })
    );

    const seen = new Set();
    const products = [];
    for (const result of results) {
      for (const product of result.products) {
        const key = product.url || product.name;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        products.push(product);
      }
    }

    return products.length ? { found: true, products, queries: results.map((r) => r.query) } : null;
  } catch (err) {
    console.error("[TextChannelTool] Direct product inference error:", err.message);
    return null;
  }
}

function parseLinkedProductCandidates(text) {
  const candidates = [];
  const lines = String(text || "").split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const matches = [...lines[i].matchAll(new RegExp(PRODUCT_URL_RE.source, "gi"))];
    if (!matches.length) continue;

    for (const urlMatch of matches) {
      const beforeUrl = lines[i].slice(0, urlMatch.index || 0);
      const previous = lines[i - 1] || "";
      const sameLineBoldNames = [...beforeUrl.matchAll(/\*\*([^*]+)\*\*/g)];
      const previousBoldName = previous.match(/\*\*([^*]+)\*\*/);
      const sameLineName =
        sameLineBoldNames.length > 0
          ? sameLineBoldNames[sameLineBoldNames.length - 1][1]
          : beforeUrl;
      const name = (sameLineName || previousBoldName?.[1] || previous)
        .replace(/^\s*\d+\.\s*/, "")
        .replace(/^.*?\b(?:here(?:'s| is)?|this is|link for|the link for)\s+/i, "")
        .replace(/^(here(?:'s| is)?|this is|link for|the link for)\s+/i, "")
        .replace(/^the\s+/i, "")
        .replace(/\s+link\s*:?\s*$/i, "")
        .replace(/\s+[—-]\s*$/u, "")
        .replace(/\s+[—-]\s+.*$/u, "")
        .replace(/^[\s:*_-]+|[\s:*_-]+$/g, "")
        .trim();

      if (name) {
        candidates.push({ name, url: urlMatch[0], lineIndex: i });
      }
    }
  }

  return candidates.slice(0, 5);
}

async function inferProductToolResultFromReply(reply) {
  const candidates = parseLinkedProductCandidates(reply);
  if (!candidates.length) return null;

  const products = [];
  for (const candidate of candidates) {
    try {
      const result = await productSearchApi.searchProducts(candidate.name);
      const shaped = (result.products || [])
        .slice(0, productSearchApi.RESULT_LIMIT || 5)
        .map(productSearchApi.shapeProduct);
      const match =
        shaped.find((p) => normalizeProductKey(p.name) === normalizeProductKey(candidate.name)) ||
        shaped.find((p) => {
          const productName = normalizeProductKey(p.name);
          const candidateName = normalizeProductKey(candidate.name);
          return productName && (productName.includes(candidateName) || candidateName.includes(productName));
        }) ||
        shaped[0] ||
        shaped.find((p) => p.url === candidate.url);

      products.push(
        match
          ? { ...match, requestedName: candidate.name, originalUrl: candidate.url }
          : { name: candidate.name, url: candidate.url, requestedName: candidate.name, originalUrl: candidate.url }
      );
    } catch (err) {
      console.error("[TextChannelTool] Product inference error:", err.message);
      products.push({ name: candidate.name, url: candidate.url, requestedName: candidate.name, originalUrl: candidate.url });
    }
  }

  return products.length ? { found: true, products } : null;
}

function looksLikeProductFollowUp(text) {
  return PRODUCT_FOLLOWUP_RE.test(String(text || ""));
}

function looksLikeReferentialProductFollowUp(text) {
  return /\b(what about|that|this|those|these|same|other|one|it|asked|link|links|url|send|get|grab)\b/i.test(
    String(text || "")
  );
}

function fallbackNonProductTextReply(text) {
  if (/\b(hi|hello|hey|are you there|anyone there|help)\b/i.test(String(text || ""))) {
    return "Yes, I'm here. How can I help today?";
  }
  return "";
}

function productIntentFromCustomerText(text) {
  return looksLikeDirectProductRequest(text) || looksLikeProductFollowUp(text);
}

function recentHistoryHasOrderIntent(conversationHistory = []) {
  return (conversationHistory || [])
    .slice(-8)
    .some((entry) => entry.role === "customer" && looksLikeOrderIntent(entry.text || ""));
}

async function deterministicTextOrderReply({
  text,
  channel,
  customerPhone,
  customerEmail,
  customerId,
  customerOrders,
  conversationHistory,
}) {
  if (channel !== "sms" && channel !== "whatsapp") return "";

  const orderNumber = extractOrderNumber(text);
  const email = extractEmail(text) || customerEmail || "";
  const isOrderTurn =
    looksLikeOrderIntent(text) ||
    Boolean(orderNumber) ||
    (extractEmail(text) && recentHistoryHasOrderIntent(conversationHistory));

  if (!isOrderTurn) return "";

  try {
    const result = await lookupCustomerOrder({
      orderNumber,
      email,
      customerId,
      customerEmail,
      customerPhone,
      recentOrders: customerOrders,
    });
    // This path serves SMS/WhatsApp (text channels), where the customer can't see
    // an on-screen order card — so append the clickable links to the reply. (The
    // base `message` is deliberately URL-free so voice/widget never speaks a URL.)
    let reply = result.message || "";
    if (result.found) {
      if (result.order_link) reply += `\n\nView your order: ${result.order_link}`;
      if (result.tracking_link) reply += `\nTrack it: ${result.tracking_link}`;
    }
    return compactReply(reply);
  } catch (err) {
    console.error("[TextChannelOrder] Lookup error:", err.message);
    // This turn is already known to be order-related (isOrderTurn), so falling through
    // to the full LLM/tool-use path here would just retry the same Shopify call under
    // heavier time pressure and risk hitting the outer timeout with a generic, unhelpful
    // fallback. Answer honestly and fast instead of returning "" and hoping the slow path
    // does better.
    return compactReply(
      "Sorry, I'm having trouble pulling up order details right now. Please try again in a minute, or call 02 5838 5959 for immediate help."
    );
  }
}

function requestedColor(text) {
  const match = String(text || "").match(/\b(black|white|red|blue|green|yellow|clear)\b/i);
  return match ? match[1].toLowerCase() : "";
}

function filterFollowUpProducts(products, text) {
  const color = requestedColor(text);
  if (!color) return products;

  const colorMatches = products.filter((product) => {
    const productText = normalizeProductKey(`${product.name || ""} ${product.url || ""}`);
    return productText.includes(color);
  });

  return colorMatches.length ? colorMatches : products;
}

async function inferProductToolResultFromFollowUp(text, conversationHistory = []) {
  if (!looksLikeProductFollowUp(text)) return null;

  const recentText = (conversationHistory || [])
    .slice(-8)
    .map((entry) => entry.text || "")
    .join("\n");
  const candidates = parseLinkedProductCandidates(recentText).slice(-3);
  const queries = [];
  const currentTokens = directSearchTokens(text);

  for (const entry of (conversationHistory || []).slice(-8).reverse()) {
    if (entry.role !== "customer") continue;
    for (const candidate of extractProductQueryCandidates(entry.text || "").reverse()) {
      const candidateTokens = directSearchTokens(candidate.query);
      const overlapsCurrent =
        currentTokens.length === 0 ||
        currentTokens.some((token) =>
          candidateTokens.some((candidateToken) => tokenMatchesName(token, candidateToken))
        ) ||
        (/brush(?:es)?|cutter|oval/i.test(text) && /brush(?:es)?|cutter|oval/i.test(candidate.query));
      if (overlapsCurrent) queries.push(candidate.query);
    }
    if (queries.length) break;
  }

  for (const candidate of candidates) {
    queries.push(`${candidate.name} ${text}`);
  }

  if (!queries.length) {
    const recentProductishLine = recentText
      .split(/\r?\n/)
      .reverse()
      .find((line) => /dan|graco|rust|oleum|sprayer|paint|kit|coating|sander|primer|tape|brush|cutter|oval/i.test(line));
    if (recentProductishLine) queries.push(`${recentProductishLine} ${text}`);
  }

  for (const query of [...new Set(queries.map((q) => compactProductQuery(q)).filter(Boolean))]) {
    try {
      const result = await productSearchApi.searchProducts(query);
      const products = filterFollowUpProducts(
        (result.products || []).map(productSearchApi.shapeProduct),
        text
      )
        .slice(0, productSearchApi.RESULT_LIMIT || 5)
        .slice(0, requestedColor(text) ? 1 : productSearchApi.RESULT_LIMIT || 5);
      if (products.length) return { found: true, products };
    } catch (err) {
      console.error("[TextChannelTool] Follow-up product inference error:", err.message);
    }
  }

  return null;
}

function mentionsUnavailable(text) {
  return /\b(unavailable|out of stock|not available|not showing in stock|sold out)\b/i.test(
    String(text || "")
  );
}

function applyProductAvailabilityGuard(text, productToolResult) {
  const stockNote = productAvailabilityNote(productToolResult);
  if (!stockNote) return text;

  let guarded = String(text || "");
  const products = Array.isArray(productToolResult?.products) ? productToolResult.products : [];
  const allUnavailable = products.length > 0 && products.every((p) => p.available === false);

  if (allUnavailable) {
    guarded = guarded
      .replace(/\bAll (?:of )?these are available for order\.?/gi, stockNote)
      .replace(/\bAll (?:of )?these are in stock\.?/gi, stockNote)
      .replace(/\bThese are available for order\.?/gi, stockNote)
      .replace(/\bThese are in stock\.?/gi, stockNote)
      .replace(/\bAll (?:of )?these are ready to go\.?/gi, stockNote)
      .replace(/\bAll available for order[^.!?]*[.!?]?/gi, stockNote)
      .replace(/\bAvailable for order[^.!?]*[.!?]?/gi, stockNote)
      .replace(/\bAll available now[^.!?]*[.!?]?/gi, stockNote)
      .replace(/\bAll (?:of )?these (?:products|items|kits)? ?are available[^.!?]*[.!?]?/gi, stockNote);
  }

  if (!mentionsUnavailable(guarded)) {
    guarded = `${guarded}\n\n${stockNote}`;
  }

  return guarded;
}

function findMatchingProduct(candidate, products) {
  const candidateName = normalizeProductKey(candidate?.name);
  if (!candidateName) return null;
  const meaningfulTokens = candidateName
    .split(/\s+/)
    .filter((token) => token.length > 1 && !["the", "in", "for", "link", "here", "is"].includes(token));

  return (
    products.find((p) => normalizeProductKey(p.requestedName) === candidateName) ||
    products.find((p) => p.originalUrl && candidate?.url && p.originalUrl === candidate.url) ||
    products.find((p) => normalizeProductKey(p.name) === candidateName) ||
    products.find((p) => {
      const productName = normalizeProductKey(p.name);
      return productName && (productName.includes(candidateName) || candidateName.includes(productName));
    }) ||
    products.find((p) => {
      const productName = normalizeProductKey(p.name);
      return (
        productName &&
        meaningfulTokens.length >= 2 &&
        meaningfulTokens.every((token) => productName.includes(token))
      );
    }) ||
    null
  );
}

function applyProductUrlGuard(text, productToolResult) {
  const products = Array.isArray(productToolResult?.products) ? productToolResult.products : [];
  if (!products.length) return text;

  const lines = String(text || "").split(/\r?\n/);
  for (const candidate of parseLinkedProductCandidates(text)) {
    const match = findMatchingProduct(candidate, products);
    if (
      match?.url &&
      candidate.url &&
      match.url !== candidate.url &&
      Number.isInteger(candidate.lineIndex) &&
      lines[candidate.lineIndex]
    ) {
      lines[candidate.lineIndex] = lines[candidate.lineIndex].replace(candidate.url, match.url);
    }
  }

  return lines.join("\n");
}

function formatTextChannelReply(reply, productToolResult, channel) {
  let text = normalizeTextMessageLinks(reply);
  const isTextChannel = channel === "sms" || channel === "whatsapp";
  if (!isTextChannel || !productToolResult) return compactReply(text);

  const productSummary = formatProductSummaryFromToolResult(productToolResult);
  if (!productSummary) return compactReply(text);

  if (allProductsUnavailable(productToolResult)) {
    return productSummary;
  }

  if (!text || looksLikeToolPreface(text) || mentionsWebsiteProductUi(text)) {
    return productSummary;
  }

  if (!PRODUCT_URL_RE.test(text)) {
    return compactReply(`${text}\n\n${productSummary}`);
  }

  text = applyProductUrlGuard(text, productToolResult);

  const guarded = applyProductAvailabilityGuard(text, productToolResult);
  if (guarded !== text) {
    return compactReply(guarded);
  }

  return compactReply(text);
}

function collectProductToolResults(value, results = [], seen = new WeakSet()) {
  if (value == null) return results;

  if (typeof value === "string") {
    if (!value.includes("products")) return results;
    try {
      const parsed = JSON.parse(value);
      collectProductToolResults(parsed, results, seen);
    } catch {}
    return results;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectProductToolResults(item, results, seen);
    return results;
  }

  if (typeof value !== "object") return results;
  if (seen.has(value)) return results;
  seen.add(value);

  if (
    Array.isArray(value.products) &&
    (value.found === true || value.products.length > 0)
  ) {
    results.push(value);
  }

  for (const key of Object.keys(value)) {
    collectProductToolResults(value[key], results, seen);
  }

  return results;
}

function formatConversationHistory(history) {
  const entries = Array.isArray(history) ? history : [];
  const lines = entries
    .slice(-12)
    .map((entry) => {
      const role = entry.role === "agent" ? "Jessica" : "Customer";
      const channelLabel = entry.channel ? ` via ${entry.channel}` : "";
      const text = String(entry.text || "").replace(/\s+/g, " ").trim();
      if (!text) return "";
      return `${role}${channelLabel}: ${text.slice(0, 500)}`;
    })
    .filter(Boolean);

  return lines.join("\n").slice(-5000);
}

function channelContext({
  channel,
  customerPhone,
  conversationHistory,
  customerContextSummary,
}) {
  const upperChannel = String(channel || "sms").toUpperCase();
  const historyText = formatConversationHistory(conversationHistory);
  const lines = [
    `Inbound ${upperChannel} from ${customerPhone || "unknown phone"}.`,
    "Reply naturally as Jessica from Paint Access. Keep it concise and suitable for a text message.",
    `Current channel is ${upperChannel}. Reply only in this same ${upperChannel} channel.`,
    "Do not call send_sms_notification from SMS or WhatsApp. If the customer asks for links here, include the links directly in this reply.",
  ];

  if (channel === "sms" || channel === "whatsapp") {
    lines.push(
      "This is a direct text-message channel, not the website widget.",
      "Do not mention product cards, popups, or anything being on the customer's screen.",
      "When recommending products, use search_products and include the full raw paintaccess.com.au product URLs directly in the message."
    );
  }

  if (customerContextSummary) {
    lines.push(
      "Known Shopify customer context for this phone number:",
      String(customerContextSummary).slice(0, 1600),
      "If this phone number matched a Shopify customer, that phone match is enough to discuss that customer's own recent order status and tracking in SMS/WhatsApp. In website_widget, a logged-in Shopify customer_id is enough to discuss that customer's own safe order status. Never reveal address, payment, internal notes, tags, or unrelated account details."
    );
  }

  if (historyText) {
    lines.push(
      "Recent conversation with this same phone number:",
      historyText,
      "Continue from that context. Do not ask the customer to repeat details they already gave unless needed for privacy or confirmation."
    );
  }

  return lines.join("\n");
}

async function askElevenLabsTextAgent({
  text,
  channel = "sms",
  customerPhone = "",
  customerName = "",
  customerEmail = "",
  customerContextSummary = "",
  customerId = "",
  customerTags = "",
  customerRecentOrders = "",
  customerOrders = [],
  conversationHistory = [],
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  const apiKey = cleanEnv("ELEVENLABS_API_KEY");
  const agentId = cleanEnv("ELEVENLABS_AGENT_ID");

  if (!apiKey || !agentId) {
    throw new Error("Missing ELEVENLABS_API_KEY or ELEVENLABS_AGENT_ID");
  }

  const orderReply = await deterministicTextOrderReply({
    text,
    channel,
    customerPhone,
    customerEmail,
    customerId,
    customerOrders,
    conversationHistory,
  });
  if (orderReply) return orderReply;

  const signedUrl = await getSignedUrl(agentId, apiKey);
  const WebSocketCtor = getWebSocketCtor();

  return new Promise((resolve, reject) => {
    const ws = new WebSocketCtor(signedUrl);
    let responseIndex = 0;
    let currentResponse = "";
    let latestReply = "";
    let lastReplyWasToolPreface = false;
    let latestProductToolResult = null;
    let settleTimer = null;
    let settled = false;

    const timeout = setTimeout(() => {
      if (latestProductToolResult) {
        finish(null, formatProductSummaryFromToolResult(latestProductToolResult));
        return;
      }
      if (latestReply) {
        finish(null, latestReply);
        return;
      }
      finish(new Error("ElevenLabs text response timed out"));
    }, timeoutMs);

    async function finish(err, reply) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(settleTimer);
      try {
        ws.close();
      } catch {}

      if (err) reject(err);
      else {
        let productResult = latestProductToolResult;
        let forceProductSummary = false;
        let cleanReply = compactReply(reply);
        const isTextChannel = channel === "sms" || channel === "whatsapp";
        const textChannelProductIntent =
          isTextChannel && productIntentFromCustomerText(text);

        if (isTextChannel && !textChannelProductIntent) {
          productResult = null;
          if (PRODUCT_URL_RE.test(String(reply || "")) || mentionsWebsiteProductUi(reply)) {
            reply = fallbackNonProductTextReply(text);
            cleanReply = compactReply(reply);
          }
        }

        if (isTextChannel) {
          const preferFollowUp = looksLikeReferentialProductFollowUp(text);
          const directProductResult = preferFollowUp
            ? null
            : await inferProductToolResultFromDirectRequest(text);
          const followUpProductResult =
            preferFollowUp || !directProductResult?.products?.length
              ? await inferProductToolResultFromFollowUp(text, conversationHistory)
              : null;

          if (followUpProductResult?.products?.length) {
            productResult = followUpProductResult;
            forceProductSummary = true;
          } else if (
            directProductResult?.products?.length &&
            (
              (directProductResult.queries || []).length > 1 ||
              !productResult ||
              !productResultMatchesText(text, productResult)
            )
          ) {
            productResult = directProductResult;
            forceProductSummary = true;
          }
        }
        if (!cleanReply && productResult?.products?.length) {
          resolve(formatTextChannelReply("", productResult, channel));
          return;
        }
        if (!cleanReply && isTextChannel) {
          const fallbackProductResult = await inferProductToolResultFromFollowUp(
            text,
            conversationHistory
          );
          if (fallbackProductResult?.products?.length) {
            resolve(formatTextChannelReply("", fallbackProductResult, channel));
            return;
          }
        }
        if (
          !forceProductSummary &&
          isTextChannel &&
          textChannelProductIntent &&
          PRODUCT_URL_RE.test(String(reply || ""))
        ) {
          const inferredProductResult = await inferProductToolResultFromReply(reply);
          if (inferredProductResult?.products?.length) {
            productResult = inferredProductResult;
          }
        }
        resolve(formatTextChannelReply(forceProductSummary ? "" : reply, productResult, channel));
      }
    }

    function sendCustomerMessage() {
      sendJson(ws, {
        type: "contextual_update",
        text: channelContext({
          channel,
          customerPhone,
          conversationHistory,
          customerContextSummary,
        }),
      });
      sendJson(ws, { type: "user_message", text });
    }

    function scheduleFinish(reply) {
      clearTimeout(settleTimer);

      const waitMs = looksLikeToolPreface(reply)
        ? TOOL_REPLY_SETTLE_MS
        : NORMAL_REPLY_SETTLE_MS;

      settleTimer = setTimeout(() => {
        if (lastReplyWasToolPreface && latestProductToolResult) {
          finish(null, formatProductSummaryFromToolResult(latestProductToolResult));
          return;
        }
        finish(null, latestReply);
      }, waitMs);
    }

    ws.onopen = () => {
      sendJson(ws, {
        type: "conversation_initiation_client_data",
        conversation_config_override: {
          conversation: { text_only: true },
        },
        dynamic_variables: {
          customer_name: customerName,
          customer_email: customerEmail,
          customer_phone: customerPhone,
          customer_id: customerId,
          customer_tags: customerTags,
          customer_recent_orders: customerRecentOrders,
          customer_context_summary: customerContextSummary,
          channel,
        },
      });
    };

    ws.onmessage = async (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }

      if (data.type === "ping") {
        sendJson(ws, {
          type: "pong",
          event_id: data.ping_event?.event_id,
        });
        return;
      }

      if (data.type === "client_tool_call") {
        const call = data.client_tool_call || {};
        let result;
        try {
          result = await runTextChannelTool(call);
        } catch (err) {
          console.error("[TextChannelTool] Error:", call.tool_name, err.message);
          result = {
            found: false,
            error: "Tool failed. Ask the customer to call Paint Access or try a broader product name.",
          };
        }

        const productResults = collectProductToolResults(result);
        if (productResults.length) {
          latestProductToolResult = productResults[productResults.length - 1];
        }
        sendJson(ws, {
          type: "client_tool_result",
          tool_call_id: call.tool_call_id,
          result: typeof result === "string" ? result : JSON.stringify(result),
          is_error: Boolean(result && typeof result === "object" && result.error),
        });
        return;
      }

      const productResults = collectProductToolResults(data);
      if (productResults.length) {
        latestProductToolResult = productResults[productResults.length - 1];
      }

      if (data.type !== "agent_chat_response_part") return;

      const part = data.text_response_part || {};
      if (part.type === "start") {
        currentResponse = "";
      } else if (part.type === "delta") {
        currentResponse += part.text || "";
      } else if (part.type === "stop") {
        responseIndex += 1;

        // The agent sends its configured first_message immediately after
        // connection. Ignore that greeting and use the next response, which is
        // generated from the actual inbound SMS/WhatsApp message.
        if (responseIndex === 1) {
          sendCustomerMessage();
          return;
        }

        latestReply = currentResponse;
        lastReplyWasToolPreface = looksLikeToolPreface(currentResponse);
        scheduleFinish(currentResponse);
      }
    };

    ws.onerror = () => finish(new Error("ElevenLabs WebSocket error"));
    ws.onclose = (event) => {
      if (!settled && event.code !== 1000) {
        finish(new Error(`ElevenLabs WebSocket closed: ${event.code} ${event.reason || ""}`.trim()));
      }
    };
  });
}

module.exports = {
  askElevenLabsTextAgent,
};
