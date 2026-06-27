const { corsHeaders, rateLimit, cleanEnv } = require("../../lib/shopify");
const { askElevenLabsTextAgent } = require("../../lib/elevenlabs-text");
const { upsertWhatsAppLead } = require("../../lib/shopify-whatsapp-leads");
const {
  parseWhatsAppInbound,
  sendWhatsAppMessage,
  twimlMessage,
  verifyMetaSignature,
  verifyTwilioSignature,
} = require("../../lib/whatsapp");

const TWILIO_ACCOUNT_SID = cleanEnv("TWILIO_ACCOUNT_SID");
const TWILIO_AUTH_TOKEN = cleanEnv("TWILIO_AUTH_TOKEN");
const TWILIO_SMS_FROM = normalizePhoneEnv(
  cleanEnv("TWILIO_MOBILE_NUMBER") ||
    cleanEnv("TWILIO_PHONE_NUMBER") ||
    cleanEnv("TWILIO_SYDNEY_NUMBER")
);
const TWILIO_HISTORY_LOOKUP_TIMEOUT_MS = 2500;

function fallbackReply() {
  return "Thanks for contacting Paint Access. I can help with products, stock, orders, or painting advice. For urgent help, call 02 5838 5959.";
}

function normalizePhoneEnv(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (!raw.startsWith("+")) return raw;
  return `+${raw.replace(/\D/g, "")}`;
}

function twilioAuthHeader() {
  return `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64")}`;
}

function messageTime(message) {
  const value = message.date_sent || message.date_created || message.date_updated;
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

async function fetchTwilioMessages(params) {
  const query = new URLSearchParams({ PageSize: "12", ...params });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TWILIO_HISTORY_LOOKUP_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json?${query.toString()}`,
      {
        headers: { Authorization: twilioAuthHeader() },
        signal: controller.signal,
      }
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Twilio messages lookup failed: ${response.status} ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  return Array.isArray(data.messages) ? data.messages : [];
}

function historyRole(message) {
  return String(message.direction || "").startsWith("outbound") ? "agent" : "customer";
}

function historyText(message) {
  return String(message.body || "")
    .replace(/^Paint Access WhatsApp reply \(sent by SMS because WhatsApp delivery failed\):\s*/i, "")
    .trim();
}

async function loadTwilioWhatsAppHistory(inbound) {
  if (inbound.provider !== "twilio" || !TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) return [];

  const from = String(inbound.raw?.From || "").trim();
  const to = String(inbound.raw?.To || "").trim();
  const currentSid = String(inbound.raw?.MessageSid || inbound.raw?.SmsMessageSid || "");
  if (!from || !to) return [];

  const customerSms = normalizePhoneEnv(inbound.from);
  const lookups = [
    fetchTwilioMessages({ From: from, To: to }),
    fetchTwilioMessages({ From: to, To: from }),
  ];

  if (customerSms && TWILIO_SMS_FROM) {
    lookups.push(fetchTwilioMessages({ From: TWILIO_SMS_FROM, To: customerSms }));
  }

  const results = await Promise.all(lookups);
  return results
    .flat()
    .filter((message) => message.sid !== currentSid)
    .filter((message) => historyText(message))
    .filter((message) => {
      const status = String(message.status || "").toLowerCase();
      return historyRole(message) !== "agent" || !["failed", "undelivered"].includes(status);
    })
    .sort((a, b) => messageTime(a) - messageTime(b))
    .slice(-12)
    .map((message) => ({
      role: historyRole(message),
      text: historyText(message),
    }));
}

async function buildAgentReply(inbound, conversationHistory = []) {
  const text =
    inbound.text ||
    `[Customer sent a ${inbound.messageType || "WhatsApp"} message. Ask them to send text if the attachment cannot be processed yet.]`;

  const prompt =
    inbound.messageType && inbound.messageType !== "text"
      ? `${text}\n\nReply as Jessica. Explain that the WhatsApp channel has received the attachment, but ask for a short text description so you can help immediately.`
      : text;

  const reply = await askElevenLabsTextAgent({
    text: prompt,
    channel: "whatsapp",
    customerName: inbound.profileName || "",
    customerPhone: inbound.from,
    conversationHistory,
    timeoutMs: 20000,
  });

  return reply || fallbackReply();
}

module.exports = async function handler(req, res) {
  corsHeaders(res, req);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    const mode = req.query?.["hub.mode"];
    const token = req.query?.["hub.verify_token"];
    const challenge = req.query?.["hub.challenge"];
    const verifyToken = cleanEnv("META_WHATSAPP_VERIFY_TOKEN");

    if (mode === "subscribe" && token && verifyToken && token === verifyToken) {
      return res.status(200).send(challenge || "");
    }
    return res.status(403).send("Forbidden");
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (rateLimit(req, res)) return;

  const inbound = parseWhatsAppInbound(req);
  if (!inbound) return res.status(400).json({ error: "Unsupported WhatsApp webhook payload" });

  if (inbound.provider === "twilio" && !verifyTwilioSignature(req)) {
    res.setHeader("Content-Type", "text/xml");
    return res.status(403).send(twimlMessage("Forbidden"));
  }

  if (inbound.provider === "meta" && !verifyMetaSignature(req)) {
    return res.status(403).json({ error: "Invalid Meta webhook signature" });
  }

  try {
    console.log(`[WhatsApp] ${inbound.provider} inbound from ${inbound.from}`);

    if (!inbound.from) {
      if (inbound.provider === "twilio") {
        res.setHeader("Content-Type", "text/xml");
        return res.status(400).send(twimlMessage("Invalid request"));
      }
      return res.status(400).json({ error: "Invalid request" });
    }

    try {
      await upsertWhatsAppLead({
        phone: inbound.from,
        profileName: inbound.profileName,
        message: inbound.text,
        provider: inbound.provider,
      });
    } catch (err) {
      console.error("[WhatsApp] Shopify lead sync failed:", err.message);
    }

    let replyText = fallbackReply();
    let conversationHistory = [];

    try {
      conversationHistory = await loadTwilioWhatsAppHistory(inbound);
    } catch (err) {
      console.error("[WhatsApp] Conversation history lookup failed:", err.message);
    }

    try {
      replyText = await buildAgentReply(inbound, conversationHistory);
    } catch (err) {
      console.error("[WhatsApp] ElevenLabs text agent error:", err.message);
    }

    if (inbound.provider === "twilio") {
      res.setHeader("Content-Type", "text/xml");
      return res.status(200).send(twimlMessage(replyText));
    }

    const sent = await sendWhatsAppMessage({
      to: inbound.from,
      body: replyText,
      provider: "meta",
    });

    return res.status(200).json({ ok: true, sent });
  } catch (err) {
    console.error("[WhatsApp] Webhook error:", err);

    if (inbound.provider === "twilio") {
      res.setHeader("Content-Type", "text/xml");
      return res.status(200).send(twimlMessage(fallbackReply()));
    }

    return res.status(200).json({ ok: false, error: "Processing failed" });
  }
};
