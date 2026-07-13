/**
 * Outbound recorded voice call service (Phase 3).
 *
 * Triggers an ElevenLabs → Twilio outbound AI call to a customer. The call is
 * recorded and transcribed by ElevenLabs; the existing post-call webhook
 * (api/webhooks/elevenlabs-post-call.js → store.recordConversation) stores the
 * recording + transcript into voice_calls and threads it under the customer.
 * We also log an immediate "call started" line so the inbox shows it right away.
 *
 * Compliance: outbound calls to customers carry consent / Do Not Call Register
 * obligations. This is admin-initiated (authed endpoint / approved MCP call), not
 * mass auto-dialing — the caller is responsible for having a lawful basis.
 */
const { cleanEnv } = require("../shopify");
const { normalizeE164 } = require("../whatsapp");
const store = require("./store");

async function startOutboundCall({ to, name, email, shopifyCustomerId } = {}) {
  const toE164 = normalizeE164(to);
  if (!toE164) {
    const err = new Error("A valid recipient phone number is required.");
    err.statusCode = 400;
    throw err;
  }

  const AGENT_ID = cleanEnv("ELEVENLABS_AGENT_ID");
  const XI_KEY = cleanEnv("ELEVENLABS_API_KEY");
  const PHONE_NUM_ID = cleanEnv("ELEVENLABS_PHONE_NUMBER_ID");
  if (!AGENT_ID || !XI_KEY || !PHONE_NUM_ID) {
    const err = new Error("Outbound calling is not configured.");
    err.statusCode = 503;
    throw err;
  }

  const dynamic_variables = { customer_phone: toE164 };
  if (name) dynamic_variables.customer_name = name;
  if (email) dynamic_variables.customer_email = email;
  if (shopifyCustomerId) dynamic_variables.customer_id = String(shopifyCustomerId);

  const response = await fetch("https://api.elevenlabs.io/v1/convai/twilio/outbound_call", {
    method: "POST",
    headers: { "Content-Type": "application/json", "xi-api-key": XI_KEY },
    body: JSON.stringify({
      agent_id: AGENT_ID,
      agent_phone_number_id: PHONE_NUM_ID,
      to_number: toE164,
      conversation_initiation_client_data: { dynamic_variables },
    }),
  });

  const raw = await response.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { message: raw };
  }
  if (!response.ok) {
    const err = new Error(data.message || `Outbound call failed with ${response.status}`);
    err.statusCode = response.status >= 500 ? 502 : 400;
    throw err;
  }

  // Immediate inbox line; the post-call webhook adds the recorded transcript later.
  await store.recordOutbound({
    channel: "voice",
    toPhone: toE164,
    author: "system",
    body: "📞 Outbound AI call started",
    status: "initiated",
    name,
    email,
    shopifyCustomerId,
  });

  return {
    ok: true,
    to: toE164,
    conversation_id: data.conversation_id || null,
    call_sid: data.callSid || data.call_sid || null,
  };
}

module.exports = { startOutboundCall };
