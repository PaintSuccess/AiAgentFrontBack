const { corsHeaders, rateLimit } = require("../../lib/shopify");
const { verifyTwilioSignature } = require("../../lib/whatsapp");

module.exports = async function handler(req, res) {
  corsHeaders(res, req);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (await rateLimit(req, res)) return;

  if (!verifyTwilioSignature(req)) {
    return res.status(403).json({ error: "Invalid Twilio signature" });
  }

  const body = req.body || {};
  const from = String(body.From || "").slice(0, 80);
  const to = String(body.To || "").slice(0, 80);
  const status = String(body.MessageStatus || body.SmsStatus || "").slice(0, 40);
  const messageSid = String(body.MessageSid || body.SmsSid || "").slice(0, 80);
  const errorCode = String(body.ErrorCode || "").slice(0, 40);

  console.log("[WhatsApp Status]", {
    messageSid,
    status,
    from,
    to,
    errorCode: errorCode || undefined,
  });

  return res.status(200).json({ ok: true });
};
