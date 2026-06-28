const { corsHeaders, rateLimit, cleanEnv } = require("../../lib/shopify");
const { askElevenLabsTextAgent } = require("../../lib/elevenlabs-text");
const { upsertWhatsAppLead } = require("../../lib/shopify-whatsapp-leads");
const { getCustomerContextByPhone } = require("../../lib/shopify-customer-context");
const { loadTwilioTextHistory } = require("../../lib/twilio-text-history");
const {
  parseWhatsAppInbound,
  sendWhatsAppMessage,
  twimlMessage,
  verifyMetaSignature,
  verifyTwilioSignature,
} = require("../../lib/whatsapp");

function fallbackReply() {
  return "Thanks for contacting Paint Access. I can help with products, stock, orders, or painting advice. For urgent help, call 02 5838 5959.";
}

async function buildAgentReply(inbound, conversationHistory = [], customerContext = null) {
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
    customerName: customerContext?.customer_name || inbound.profileName || "",
    customerEmail: customerContext?.customer_email || "",
    customerPhone: inbound.from,
    customerContextSummary: customerContext?.customer_context_summary || "",
    customerId: customerContext?.customer_id || "",
    customerTags: customerContext?.customer_tags || "",
    customerRecentOrders: customerContext?.customer_recent_orders || "",
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
    let customerContext = null;

    try {
      conversationHistory = await loadTwilioTextHistory({
        customerPhone: inbound.from,
        currentSid: inbound.raw?.MessageSid || inbound.raw?.SmsMessageSid || "",
        currentFrom: inbound.raw?.From || "",
        currentTo: inbound.raw?.To || "",
      });
    } catch (err) {
      console.error("[WhatsApp] Conversation history lookup failed:", err.message);
    }

    try {
      customerContext = await getCustomerContextByPhone(inbound.from);
    } catch (err) {
      console.error("[WhatsApp] Customer context lookup failed:", err.message);
    }

    try {
      replyText = await buildAgentReply(inbound, conversationHistory, customerContext);
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
