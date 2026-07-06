const { cleanEnv } = require("./shopify");
const productSearchApi = require("../api/shopify/products");

const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";
const DEFAULT_TIMEOUT_MS = 18000;
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
  "paintaccess", "whatsapp", "support", "chat", "business",
]);

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

  if (
    /\b(hi|hello|hey)\b/.test(normalized) &&
    /\b(paint\s*access|paintaccess|whatsapp support chat|support chat)\b/.test(normalized) &&
    directSearchTokens(text).length === 0
  ) {
    return false;
  }

  if (
    /\b(link|links|url|urls|product|products|recommend|recommendation|price|stock|available|buy|sprayer|kit|coating|roller|sander|primer|tape|brush|graco|dan|dans|rust|oleum|wagner|masking|floor|epoxy)\b/i.test(
      normalized
    )
  ) {
    return true;
  }

  return (
    /\b(get|find|looking|need|want|show|send|grab)\b/i.test(normalized) &&
    directSearchTokens(text).length >= 2
  );
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

  const tokens = directSearchTokens(text);
  if (!tokens.length) return null;

  try {
    const result = await productSearchApi.searchProducts(text);
    const products = (result.products || [])
      .slice(0, productSearchApi.RESULT_LIMIT || 5)
      .map(productSearchApi.shapeProduct);
    return products.length ? { found: true, products } : null;
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
  return /\b(link|links|url|send|get|grab|black|white|red|blue|that one|this one|same one|other one|one too|wheeled|backpack|compact|cart|sprayer|kit)\b/i.test(
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

  for (const candidate of candidates) {
    queries.push(`${candidate.name} ${text}`);
  }

  if (!queries.length) {
    const recentProductishLine = recentText
      .split(/\r?\n/)
      .reverse()
      .find((line) => /dan|graco|rust|oleum|sprayer|paint|kit|coating|sander|primer|tape/i.test(line));
    if (recentProductishLine) queries.push(`${recentProductishLine} ${text}`);
  }

  for (const query of queries) {
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
      "Use this context to be helpful, but do not reveal private order, address, or payment details unless the customer passes the normal order lookup check."
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
  conversationHistory = [],
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  const apiKey = cleanEnv("ELEVENLABS_API_KEY");
  const agentId = cleanEnv("ELEVENLABS_AGENT_ID");

  if (!apiKey || !agentId) {
    throw new Error("Missing ELEVENLABS_API_KEY or ELEVENLABS_AGENT_ID");
  }

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
          const directProductResult = await inferProductToolResultFromDirectRequest(text);
          if (
            directProductResult?.products?.length &&
            (!productResult || !productResultMatchesText(text, productResult))
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
