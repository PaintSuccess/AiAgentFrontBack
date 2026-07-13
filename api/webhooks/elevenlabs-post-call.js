const crypto = require("crypto");
const { corsHeaders, cleanEnv, rateLimit } = require("../../lib/shopify");
const {
  formatFields,
  formatTranscript,
} = require("../../lib/trade-email");
const { createAiCallNotification } = require("../../lib/shopify-call-notification");
const commsStore = require("../../lib/comms/store");

const WEBHOOK_SECRET = cleanEnv("ELEVENLABS_WEBHOOK_SECRET");
const AGENT_ID = cleanEnv("ELEVENLABS_AGENT_ID");
const API_SECRET_TOKEN = cleanEnv("API_SECRET_TOKEN");

function getRawBody(req) {
  if (typeof req.rawBody === "string" || Buffer.isBuffer(req.rawBody)) {
    return Buffer.from(req.rawBody);
  }
  return Buffer.from(JSON.stringify(req.body || {}));
}

function verifySignature(req) {
  if (!WEBHOOK_SECRET) return true;

  const signature = req.headers["elevenlabs-signature"];
  if (!signature) return false;

  const rawBody = getRawBody(req);
  const parts = Object.fromEntries(
    String(signature)
      .split(",")
      .map((part) => part.trim().split("="))
      .filter(([key, value]) => key && value)
  );
  const timestamp = parts.t;
  const candidate = parts.v0;

  if (!timestamp || !candidate) return false;

  const timestampSeconds = Number(timestamp);
  const toleranceSeconds = 30 * 60;
  if (
    !Number.isFinite(timestampSeconds) ||
    Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds) > toleranceSeconds
  ) {
    return false;
  }

  const expected = crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(`${timestamp}.${rawBody.toString("utf8")}`)
    .digest("hex");

  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verifyWebhookAuth(req) {
  if (verifySignature(req)) return true;

  const authHeader = req.headers.authorization || "";
  const token =
    String(req.headers["x-paintaccess-webhook-token"] || "").trim() ||
    authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!API_SECRET_TOKEN || !token) return false;

  const a = Buffer.from(token);
  const b = Buffer.from(API_SECRET_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function mapSource(source, metadata = {}) {
  const sourceText = String(source || "").toLowerCase();
  const phoneData = metadata.phone_call || metadata.twilio || metadata.call || {};
  if (
    sourceText.includes("phone") ||
    sourceText.includes("twilio") ||
    phoneData.caller_id ||
    phoneData.called_number
  ) {
    return "Call";
  }
  if (sourceText.includes("sms")) return "SMS";
  if (sourceText.includes("whatsapp")) return "WhatsApp";
  return "Chat";
}

module.exports = async function handler(req, res) {
  corsHeaders(res, req);
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (await rateLimit(req, res)) return;

  if (!verifyWebhookAuth(req)) {
    return res.status(401).json({ error: "Invalid webhook signature" });
  }

  const event = req.body || {};
  const data = event.data || {};

  if (event.type === "call_initiation_failure") {
    if (AGENT_ID && data.agent_id && data.agent_id !== AGENT_ID) {
      return res.status(200).json({ ok: true, ignored: "different_agent" });
    }

    const metadata = data.metadata || {};
    const notification = await createAiCallNotification({
      event_type: "call_initiation_failure",
      channel: "Call",
      subject: `Paint Access AI call failed: ${data.failure_reason || "unknown"}`,
      conversation_id: data.conversation_id,
      status: "failed",
      agent: data.agent_id,
      summary: data.failure_reason || "AI call failed before a transcript was created.",
      raw_payload: event,
      transcript: [
        "An AI call failed before a transcript was created.",
        "",
        formatFields({
          Channel: "Call",
          "Conversation ID": data.conversation_id,
          Agent: data.agent_id,
          Reason: data.failure_reason,
          "Metadata type": metadata.type,
        }),
        "",
        "Raw metadata:",
        JSON.stringify(metadata.body || metadata, null, 2),
      ].join("\n"),
    });

    return res.status(200).json({ ok: true, notification });
  }

  if (event.type !== "post_call_transcription") {
    return res.status(200).json({ ok: true, ignored: event.type || "unknown" });
  }

  if (AGENT_ID && data.agent_id && data.agent_id !== AGENT_ID) {
    return res.status(200).json({ ok: true, ignored: "different_agent" });
  }

  const dynVars = data.conversation_initiation_client_data?.dynamic_variables || {};
  const metadata = data.metadata || {};
  const analysis = data.analysis || {};
  const phoneData = metadata.phone_call || metadata.twilio || metadata.call || {};
  const channel = mapSource(data.conversation_initiation_source, metadata);
  const title =
    analysis.call_summary_title ||
    analysis.transcript_summary ||
    `${channel} conversation ${data.conversation_id || ""}`.trim();
  const startedAt = metadata.start_time_unix_secs
    ? new Date(metadata.start_time_unix_secs * 1000).toISOString()
    : "";

  const notification = await createAiCallNotification({
    event_type: "post_call_transcription",
    channel,
    subject: `Paint Access AI ${channel}: ${title}`.slice(0, 180),
    conversation_id: data.conversation_id,
    status: data.status,
    agent: data.agent_name || data.agent_id,
    started_at: startedAt,
    duration: metadata.call_duration_secs ? `${metadata.call_duration_secs}s` : "",
    result: analysis.call_successful,
    customer_name: (dynVars.customer_name || "").replace(/^,\s*/, "").trim(),
    customer_email: dynVars.customer_email,
    customer_phone: dynVars.customer_phone || phoneData.caller_id || phoneData.from_number,
    called_number: phoneData.called_number || phoneData.to_number,
    summary: analysis.transcript_summary || "(No summary available)",
    transcript: [
      "An AI conversation finished and the transcript is ready.",
      "",
      formatFields({
        Channel: channel,
        "Conversation ID": data.conversation_id,
        Status: data.status,
        Agent: data.agent_name || data.agent_id,
        Started: startedAt,
        Duration: metadata.call_duration_secs ? `${metadata.call_duration_secs}s` : "",
        Result: analysis.call_successful,
        "Customer name": (dynVars.customer_name || "").replace(/^,\s*/, "").trim(),
        "Customer email": dynVars.customer_email,
        "Customer phone": dynVars.customer_phone || phoneData.caller_id || phoneData.from_number,
        "Called number": phoneData.called_number || phoneData.to_number,
      }),
      "",
      "Summary:",
      analysis.transcript_summary || "(No summary available)",
      "",
      "Transcript:",
      formatTranscript(data.transcript || []),
    ].join("\n"),
    raw_payload: event,
  });

  // Persist voice calls and widget chats to the comms spine (fail-safe). SMS/WhatsApp
  // are already captured per-message by their own webhooks, so skip them here to
  // avoid double-recording.
  const channelLower = channel.toLowerCase();
  if (channelLower === "call" || channelLower === "chat") {
    await commsStore.recordConversation({
      channel: channelLower,
      conversationId: data.conversation_id,
      phone:
        dynVars.customer_phone ||
        phoneData.external_number ||
        phoneData.caller_id ||
        phoneData.called_number,
      email: dynVars.customer_email,
      name: (dynVars.customer_name || "").replace(/^,\s*/, "").trim(),
      shopifyCustomerId: dynVars.customer_id,
      direction: phoneData.direction || "inbound",
      transcript: (data.transcript || []).map((t) => ({
        role: t.role,
        message: t.message,
        ts: t.time_in_call_secs,
      })),
      summary: analysis.transcript_summary,
      title,
      status: data.status,
      durationSeconds: metadata.call_duration_secs,
      result: analysis.call_successful,
      twilioCallSid: phoneData.call_sid || phoneData.callSid || null,
      startedAt: metadata.start_time_unix_secs,
      cost: metadata.cost,
    });
  }

  return res.status(200).json({ ok: true, notification });
};
