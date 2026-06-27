const { cleanEnv } = require("./shopify");

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

function smsToolResult(toolName) {
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
    /\b(let me|i'?ll|i will|just|no worries).{0,60}\b(search|check|look up|find|confirm)\b/.test(normalized) ||
    /\b(searching|checking|looking that up|checking our stock)\b/.test(normalized)
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

    function finish(err, reply) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(settleTimer);
      try {
        ws.close();
      } catch {}

      if (err) reject(err);
      else resolve(formatTextChannelReply(reply, latestProductToolResult, channel));
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

    ws.onmessage = (event) => {
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
        const productResults = collectProductToolResults(call);
        if (productResults.length) {
          latestProductToolResult = productResults[productResults.length - 1];
        }
        sendJson(ws, {
          type: "client_tool_result",
          tool_call_id: call.tool_call_id,
          result: smsToolResult(call.tool_name),
          is_error: false,
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
