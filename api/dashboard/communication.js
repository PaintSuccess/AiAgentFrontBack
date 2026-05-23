/**
 * GET /api/dashboard/communication?id=...
 * Unified detail endpoint for ElevenLabs conversations and Twilio message/call logs.
 */
const { requireDashboardAuth } = require("../../lib/dashboard-auth");
const { cleanEnv } = require("../../lib/shopify");

const ELEVENLABS_API_KEY = cleanEnv("ELEVENLABS_API_KEY");
const TWILIO_ACCOUNT_SID = cleanEnv("TWILIO_ACCOUNT_SID");
const TWILIO_AUTH_TOKEN = cleanEnv("TWILIO_AUTH_TOKEN");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = requireDashboardAuth(req, res);
  if (!session) return;

  const id = String(req.query.id || "").trim();
  if (!id) return res.status(400).json({ error: "Missing communication ID" });

  try {
    if (id.startsWith("twilio-message:")) {
      return res.status(200).json(await getTwilioMessage(id.replace("twilio-message:", "")));
    }

    if (id.startsWith("twilio-call:")) {
      return res.status(200).json(await getTwilioCall(id.replace("twilio-call:", "")));
    }

    return res.status(200).json(await getElevenLabsConversation(id));
  } catch (err) {
    console.error("Dashboard communication detail error:", err);
    return res.status(err.statusCode || 500).json({
      error: err.publicMessage || "Failed to fetch communication detail",
    });
  }
};

async function getElevenLabsConversation(convId) {
  if (!/^[a-zA-Z0-9_]+$/.test(convId)) {
    const err = new Error("Invalid conversation ID");
    err.statusCode = 400;
    err.publicMessage = "Invalid conversation ID";
    throw err;
  }

  const response = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversations/${convId}`,
    { headers: { "xi-api-key": ELEVENLABS_API_KEY } }
  );

  if (!response.ok) {
    const err = new Error(`ElevenLabs detail ${response.status}: ${await response.text()}`);
    err.statusCode = response.status === 404 ? 404 : 502;
    err.publicMessage = response.status === 404 ? "Conversation not found" : "Failed to fetch conversation";
    throw err;
  }

  const conv = await response.json();
  const dynVars = conv.conversation_initiation_client_data?.dynamic_variables || {};

  return {
    id: conv.conversation_id,
    agent_name: conv.agent_name,
    status: conv.status,
    source: conv.conversation_initiation_source || "unknown",
    type: mapSource(conv.conversation_initiation_source),
    customer_name: (dynVars.customer_name || "").replace(/^,\s*/, "").trim() || null,
    customer_email: dynVars.customer_email || null,
    customer_id: dynVars.customer_id || null,
    customer_phone: dynVars.customer_phone || null,
    started_at: conv.metadata?.start_time_unix_secs
      ? new Date(conv.metadata.start_time_unix_secs * 1000).toISOString()
      : null,
    duration_seconds: conv.metadata?.call_duration_secs || 0,
    cost: conv.metadata?.cost || 0,
    termination_reason: conv.metadata?.termination_reason || null,
    call_successful: conv.analysis?.call_successful || null,
    summary: conv.analysis?.transcript_summary || null,
    title: conv.analysis?.call_summary_title || null,
    transcript: (conv.transcript || []).map((entry) => ({
      role: entry.role,
      message: entry.message,
      timestamp: entry.time_in_call_secs || null,
    })),
    feedback: conv.metadata?.feedback || null,
  };
}

async function getTwilioMessage(sid) {
  if (!/^SM[a-zA-Z0-9]+$/.test(sid) && !/^MM[a-zA-Z0-9]+$/.test(sid)) {
    const err = new Error("Invalid Twilio message SID");
    err.statusCode = 400;
    err.publicMessage = "Invalid Twilio message ID";
    throw err;
  }

  const rec = await twilioFetch(`Messages/${sid}.json`);
  const isInbound = String(rec.direction || "").startsWith("inbound");
  const isWhatsApp = String(rec.from || rec.to || "").includes("whatsapp:");
  const from = String(rec.from || "").replace("whatsapp:", "");
  const to = String(rec.to || "").replace("whatsapp:", "");

  return {
    id: `twilio-message:${rec.sid}`,
    type: isWhatsApp ? "whatsapp" : "sms",
    status: rec.status,
    source: "twilio",
    customer_phone: isInbound ? from : to,
    started_at: rec.date_sent || rec.date_created,
    duration_seconds: 0,
    summary: rec.body || "",
    title: `${isWhatsApp ? "WhatsApp" : "SMS"} ${isInbound ? "from" : "to"} ${isInbound ? from : to}`,
    transcript: [
      {
        role: isInbound ? "user" : "agent",
        message: rec.body || "",
        timestamp: null,
      },
    ],
    metadata: {
      from,
      to,
      direction: rec.direction,
      price: rec.price,
      error_code: rec.error_code,
      error_message: rec.error_message,
    },
  };
}

async function getTwilioCall(sid) {
  if (!/^CA[a-zA-Z0-9]+$/.test(sid)) {
    const err = new Error("Invalid Twilio call SID");
    err.statusCode = 400;
    err.publicMessage = "Invalid Twilio call ID";
    throw err;
  }

  const rec = await twilioFetch(`Calls/${sid}.json`);
  return {
    id: `twilio-call:${rec.sid}`,
    type: "call",
    status: rec.status,
    source: "twilio",
    customer_phone: rec.direction?.startsWith("inbound") ? rec.from : rec.to,
    started_at: rec.start_time || rec.date_created,
    duration_seconds: parseInt(rec.duration, 10) || 0,
    summary: `Twilio ${rec.direction || "call"} ${rec.status || ""}`.trim(),
    title: `Call ${rec.from || ""} to ${rec.to || ""}`,
    transcript: [],
    metadata: {
      from: rec.from,
      to: rec.to,
      direction: rec.direction,
      price: rec.price,
      end_time: rec.end_time,
    },
  };
}

async function twilioFetch(path) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    const err = new Error("Twilio not configured");
    err.statusCode = 503;
    err.publicMessage = "Twilio not configured";
    throw err;
  }

  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/${path}`,
    { headers: { Authorization: `Basic ${auth}` } }
  );

  if (!response.ok) {
    const err = new Error(`Twilio ${path} ${response.status}: ${await response.text()}`);
    err.statusCode = response.status === 404 ? 404 : 502;
    err.publicMessage = response.status === 404 ? "Twilio record not found" : "Failed to fetch Twilio record";
    throw err;
  }

  return response.json();
}

function mapSource(source) {
  if (!source) return "chat";
  const s = source.toLowerCase();
  if (s.includes("phone") || s.includes("twilio")) return "call";
  if (s.includes("sms")) return "sms";
  if (s.includes("whatsapp")) return "whatsapp";
  return "chat";
}
