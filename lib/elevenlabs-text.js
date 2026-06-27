const { cleanEnv } = require("./shopify");
const productSearchApi = require("../api/shopify/products");

const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";
const DEFAULT_TIMEOUT_MS = 18000;
const NORMAL_REPLY_SETTLE_MS = 1400;
const TOOL_REPLY_SETTLE_MS = 6500;
const PRODUCT_URL_RE = /https?:\/\/(?:www\.)?paintaccess\.com\.au\/products\/[^\s)\]]+/i;

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
  return String(text || "").replace(
    /\[([^\]]{1,120})\]\((https?:\/\/(?:www\.)?paintaccess\.com\.au\/products\/[^)\s]+)\)/gi,
    "$1: $2"
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

function normalizeProductKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseLinkedProductCandidates(text) {
  const candidates = [];
  const lines = String(text || "").split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const urlMatch = lines[i].match(PRODUCT_URL_RE);
    if (!urlMatch) continue;

    const previous = lines[i - 1] || "";
    const boldName = previous.match(/\*\*([^*]+)\*\*/);
    const name = (boldName?.[1] || previous)
      .replace(/^\s*\d+\.\s*/, "")
      .replace(/\s+[—-]\s+.*$/, "")
      .trim();

    if (name) {
      candidates.push({ name, url: urlMatch[0] });
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
        shaped.find((p) => p.url === candidate.url) ||
        shaped.find((p) => normalizeProductKey(p.name) === normalizeProductKey(candidate.name));

      products.push(match || { name: candidate.name, url: candidate.url });
    } catch (err) {
      console.error("[TextChannelTool] Product inference error:", err.message);
      products.push({ name: candidate.name, url: candidate.url });
    }
  }

  return products.length ? { found: true, products } : null;
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
      .replace(/\bAvailable for order[^.!?]*[.!?]?/gi, stockNote);
  }

  if (!mentionsUnavailable(guarded)) {
    guarded = `${guarded}\n\n${stockNote}`;
  }

  return guarded;
}

function findMatchingProduct(candidate, products) {
  const candidateName = normalizeProductKey(candidate?.name);
  if (!candidateName) return null;

  return (
    products.find((p) => normalizeProductKey(p.name) === candidateName) ||
    products.find((p) => {
      const productName = normalizeProductKey(p.name);
      return productName && (productName.includes(candidateName) || candidateName.includes(productName));
    }) ||
    null
  );
}

function applyProductUrlGuard(text, productToolResult) {
  const products = Array.isArray(productToolResult?.products) ? productToolResult.products : [];
  if (!products.length) return text;

  let guarded = String(text || "");
  for (const candidate of parseLinkedProductCandidates(text)) {
    const match = findMatchingProduct(candidate, products);
    if (match?.url && candidate.url && match.url !== candidate.url) {
      guarded = guarded.replaceAll(candidate.url, match.url);
    }
  }

  return guarded;
}

function formatTextChannelReply(reply, productToolResult, channel) {
  let text = normalizeTextMessageLinks(reply);
  const isTextChannel = channel === "sms" || channel === "whatsapp";
  if (!isTextChannel || !productToolResult) return compactReply(text);

  const productSummary = formatProductSummaryFromToolResult(productToolResult);
  if (!productSummary) return compactReply(text);

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
      const text = String(entry.text || "").replace(/\s+/g, " ").trim();
      if (!text) return "";
      return `${role}: ${text.slice(0, 500)}`;
    })
    .filter(Boolean);

  return lines.join("\n").slice(-5000);
}

function channelContext({ channel, customerPhone, conversationHistory }) {
  const upperChannel = String(channel || "sms").toUpperCase();
  const historyText = formatConversationHistory(conversationHistory);
  const lines = [
    `Inbound ${upperChannel} from ${customerPhone || "unknown phone"}.`,
    "Reply naturally as Jessica from Paint Access. Keep it concise and suitable for a text message.",
  ];

  if (channel === "sms" || channel === "whatsapp") {
    lines.push(
      "This is a direct text-message channel, not the website widget.",
      "Do not mention product cards, popups, or anything being on the customer's screen.",
      "When recommending products, include the full raw paintaccess.com.au product URLs directly in the message."
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
        const productResult =
          latestProductToolResult ||
          ((channel === "sms" || channel === "whatsapp") && PRODUCT_URL_RE.test(String(reply || ""))
            ? await inferProductToolResultFromReply(reply)
            : null);
        resolve(formatTextChannelReply(reply, productResult, channel));
      }
    }

    function sendCustomerMessage() {
      sendJson(ws, {
        type: "contextual_update",
        text: channelContext({ channel, customerPhone, conversationHistory }),
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
