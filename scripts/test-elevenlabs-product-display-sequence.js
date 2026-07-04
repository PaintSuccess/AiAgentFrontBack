#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const ROOT = path.resolve(__dirname, "..");
const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";
const SCREEN_CLAIM_RE =
  /\b(i(?:'ve| have| just)? put|details? (?:is|are) on|products? (?:is|are) on|links? (?:is|are) on|they(?:'re| are) on|shown|displayed|product cards? (?:are|is) up|you can see)\b/i;

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

loadEnv(path.join(ROOT, ".env"));

const API_KEY = process.env.ELEVENLABS_API_KEY;
const AGENT_ID = process.env.ELEVENLABS_AGENT_ID;

function sendJson(ws, payload) {
  ws.send(JSON.stringify(payload));
}

async function getSignedUrl() {
  if (!API_KEY) throw new Error("Missing ELEVENLABS_API_KEY");
  if (!AGENT_ID) throw new Error("Missing ELEVENLABS_AGENT_ID");

  const response = await fetch(
    `${ELEVENLABS_BASE}/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(AGENT_ID)}`,
    { headers: { "xi-api-key": API_KEY } }
  );

  if (!response.ok) {
    throw new Error(`Signed URL failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  if (!data.signed_url) throw new Error("Signed URL response missing signed_url");
  return data.signed_url;
}

async function fetchConversation(conversationId) {
  const response = await fetch(
    `${ELEVENLABS_BASE}/convai/conversations/${encodeURIComponent(conversationId)}`,
    { headers: { "xi-api-key": API_KEY } }
  );

  if (!response.ok) {
    throw new Error(`Conversation fetch failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

async function fetchCompletedConversation(conversationId) {
  let latest = null;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      latest = await fetchConversation(conversationId);
    } catch (error) {
      if (attempt === 11) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2500));
      continue;
    }
    const transcript = latest.transcript || [];
    const hasUserTurn = transcript.some((turn) => turn.role === "user");
    const hasToolActivity = transcript.some(
      (turn) => (turn.tool_calls || []).length || (turn.tool_results || []).length
    );

    if (latest.status === "done" && hasUserTurn && hasToolActivity) {
      return latest;
    }

    await new Promise((resolve) => setTimeout(resolve, 2500));
  }

  return latest;
}

function toolName(tool) {
  return tool?.tool_name || tool?.name || "";
}

function hasProducts(result) {
  let value = result?.result_value || result?.result || "";
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return false;
    }
  }

  return Array.isArray(value?.products) && value.products.length > 0;
}

function validateTranscript(testCase, conversation) {
  const transcript = conversation.transcript || [];
  const events = [];
  let pendingProductSearches = 0;
  let sawSearch = false;
  let sawDisplay = false;

  for (const turn of transcript) {
    for (const call of turn.tool_calls || []) {
      const name = toolName(call);
      if (!name) continue;
      events.push(`tool_call: ${name}`);
      if (name === "search_products") sawSearch = true;
      if (name === "display_products_in_chat") {
        sawDisplay = true;
        if (pendingProductSearches > 0) pendingProductSearches -= 1;
      }
    }

    for (const result of turn.tool_results || []) {
      const name = toolName(result);
      if (!name) continue;
      events.push(`tool_result: ${name}`);
      if (name === "search_products" && hasProducts(result)) {
        pendingProductSearches += 1;
      }
    }

    if (turn.message) {
      const message = String(turn.message).trim().replace(/\s+/g, " ");
      events.push(`${turn.role || "message"}: ${message}`);
      if (pendingProductSearches > 0 && SCREEN_CLAIM_RE.test(message)) {
        return {
          ok: false,
          events,
          error: "agent claimed products were on screen before display_products_in_chat",
        };
      }
    }
  }

  if (!sawSearch) {
    return { ok: false, events, error: "search_products was not called" };
  }

  if (!sawDisplay) {
    return { ok: false, events, error: "display_products_in_chat was not called" };
  }

  if (pendingProductSearches > 0) {
    return {
      ok: false,
      events,
      error: "search_products returned products without a later display_products_in_chat call",
    };
  }

  return { ok: true, events };
}

async function runCase(testCase) {
  const signedUrl = await getSignedUrl();

  const conversationId = await new Promise((resolve, reject) => {
    const ws = new WebSocket(signedUrl);
    let id = "";
    let responseIndex = 0;
    let currentResponse = "";
    let userMessageSent = false;
    let closeTimer = null;
    const hardTimer = setTimeout(() => {
      try {
        ws.close(1000);
      } catch {}
      if (id) resolve(id);
      else reject(new Error(`${testCase.name}: timed out before conversation metadata`));
    }, 60000);

    function scheduleClose() {
      clearTimeout(closeTimer);
      closeTimer = setTimeout(() => {
        clearTimeout(hardTimer);
        try {
          ws.close(1000);
        } catch {}
        if (id) resolve(id);
        else reject(new Error(`${testCase.name}: missing conversation id`));
      }, 12000);
    }

    function sendUserMessage() {
      if (userMessageSent) return;
      userMessageSent = true;
      sendJson(ws, {
        type: "contextual_update",
        text:
          "Current channel: website_widget. Product cards are available. " +
          "Whenever search_products returns products, display_products_in_chat must be called before saying products are on screen.",
      });
      sendJson(ws, { type: "user_message", text: testCase.message });
      scheduleClose();
    }

    ws.on("open", () => {
      sendJson(ws, {
        type: "conversation_initiation_client_data",
        conversation_config_override: {
          conversation: { text_only: true },
        },
        dynamic_variables: {
          channel: "website_widget",
          conversation_mode: "voice",
          ui_surface: "website_widget",
          display_products_available: "true",
          customer_name: "",
          customer_greeting: "",
          customer_email: "",
          customer_id: "",
          customer_phone: "",
          customer_tags: "",
          customer_recent_orders: "",
          customer_context_summary: "",
        },
      });
    });

    ws.on("message", (raw) => {
      let data;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (data.type === "conversation_initiation_metadata") {
        id = data.conversation_initiation_metadata_event?.conversation_id || id;
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
          result: "displayed",
          is_error: false,
        });
        scheduleClose();
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
        if (responseIndex === 1) {
          sendUserMessage();
        } else {
          scheduleClose();
        }
      }
    });

    ws.on("error", (error) => {
      clearTimeout(hardTimer);
      clearTimeout(closeTimer);
      reject(new Error(`${testCase.name}: websocket error: ${error.message}`));
    });
  });

  const conversation = await fetchCompletedConversation(conversationId);
  const validation = validateTranscript(testCase, conversation);

  if (!validation.ok) {
    const details = validation.events.map((event) => `  - ${event}`).join("\n");
    throw new Error(`${testCase.name}: ${validation.error}\nConversation: ${conversationId}\n${details}`);
  }

  return { conversationId, events: validation.events };
}

async function main() {
  const cases = [
    {
      name: "show-only",
      message: "Please show me DAN'S Airless Backpack and DAN'S Compact paint sprayers on my screen.",
    },
    {
      name: "show-and-sms",
      message: "Yeah please, put DAN'S Airless Backpack on my screen and send me an SMS.",
    },
  ];

  console.log("ElevenLabs product display sequence regression test\n");

  for (const testCase of cases) {
    const result = await runCase(testCase);
    console.log(`PASS ${testCase.name} (${result.conversationId})`);
    for (const event of result.events) console.log(`  ${event}`);
    console.log("");
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
