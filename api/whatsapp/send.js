const { cleanEnv, corsHeaders, rateLimit, verifyAuth } = require("../../lib/shopify");
const { sendWhatsAppMessage, normalizeE164, getProvider } = require("../../lib/whatsapp");

function cleanMessage(value) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s{3,}/g, " ")
    .trim()
    .slice(0, 4096);
}

function resolveTemplate(template, provider) {
  if (!template || provider !== "twilio" || template.contentSid) return template;

  const key = String(template.key || template.name || "").trim().toLowerCase();
  const sidByKey = {
    support_followup: cleanEnv("WHATSAPP_TEMPLATE_SUPPORT_FOLLOWUP"),
    quote_ready: cleanEnv("WHATSAPP_TEMPLATE_QUOTE_READY"),
    order_enquiry_update: cleanEnv("WHATSAPP_TEMPLATE_ORDER_ENQUIRY_UPDATE"),
  };

  return {
    ...template,
    contentSid: sidByKey[key] || "",
  };
}

module.exports = async function handler(req, res) {
  corsHeaders(res, req);
  if (req.method === "OPTIONS") return res.status(200).end();

  if (!verifyAuth(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (await rateLimit(req, res)) return;

  try {
    const payload = req.body || {};
    const to = normalizeE164(payload.to);
    const type = String(payload.type || "text").toLowerCase();
    const provider = getProvider(payload.provider);

    if (!to) return res.status(400).json({ error: "Valid WhatsApp recipient phone is required." });

    const body = cleanMessage(payload.body || payload.message || payload.text);
    const template = resolveTemplate(payload.template || null, provider);
    const media = payload.media || null;

    if (type === "text" && !body) {
      return res.status(400).json({ error: "Message body is required for text sends." });
    }

    if (type === "template" && provider === "meta" && !template?.name) {
      return res.status(400).json({
        error: "Meta template sends require template.name.",
      });
    }

    if (type === "template" && provider === "twilio" && !template?.contentSid) {
      return res.status(400).json({
        error: "Twilio template sends require template.contentSid.",
      });
    }

    if (type === "media" && !(media?.url || media?.id)) {
      return res.status(400).json({ error: "Media sends require media.url or media.id." });
    }

    const sent = await sendWhatsAppMessage({
      to,
      body,
      type,
      template,
      media,
      provider,
    });

    return res.status(200).json({ ok: true, sent });
  } catch (err) {
    console.error("[WhatsApp Send] Error:", err.message, err.upstream || "");
    return res.status(err.statusCode || 500).json({
      error:
        err.statusCode === 503
          ? "WhatsApp sending is not configured yet."
          : "Could not send WhatsApp message.",
      detail: err.upstream?.error?.message || err.upstream?.message || undefined,
    });
  }
};
