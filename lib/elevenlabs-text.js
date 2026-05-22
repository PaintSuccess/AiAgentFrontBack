const { cleanEnv } = require("./shopify");

const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";
const DEFAULT_TIMEOUT_MS = 14000;

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

async function askElevenLabsTextAgent({
  text,
  channel = "sms",
  customerPhone = "",
  customerName = "",
  customerEmail = "",
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
    let settled = false;

    const timeout = setTimeout(() => {
      finish(new Error("ElevenLabs text response timed out"));
    }, timeoutMs);

    function finish(err, reply) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        ws.close();
      } catch {}

      if (err) reject(err);
      else resolve(compactReply(reply));
    }

    function sendCustomerMessage() {
      sendJson(ws, {
        type: "contextual_update",
        text:
          `Inbound ${channel.toUpperCase()} from ${customerPhone || "unknown phone"}. ` +
          "Reply naturally as Jessica from Paint Access. Keep it concise and suitable for a text message.",
      });
      sendJson(ws, { type: "user_message", text });
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
        sendJson(ws, {
          type: "client_tool_result",
          tool_call_id: call.tool_call_id,
          result: smsToolResult(call.tool_name),
          is_error: false,
        });
        return;
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

        finish(null, currentResponse);
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
