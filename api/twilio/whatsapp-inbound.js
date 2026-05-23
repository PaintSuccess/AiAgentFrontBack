const crypto = require("crypto");
const { corsHeaders, rateLimit, cleanEnv } = require("../../lib/shopify");
const { askElevenLabsTextAgent } = require("../../lib/elevenlabs-text");

function verifyTwilioSignature(req) {
  const authToken = cleanEnv("TWILIO_AUTH_TOKEN");
  if (!authToken) return true;

  const signature = req.headers["x-twilio-signature"];
  if (!signature) return false;

  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const url = `${proto}://${host}${req.url}`;

  const params = req.body || {};
  const sortedKeys = Object.keys(params).sort();
  const paramStr = sortedKeys.map((k) => k + params[k]).join("");
  const data = url + paramStr;

  const expected = crypto
    .createHmac("sha1", authToken)
    .update(data)
    .digest("base64");

  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

module.exports = async function handler(req, res) {
  corsHeaders(res, req);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (rateLimit(req, res)) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!verifyTwilioSignature(req)) {
    return res.status(403).send("<Response><Message>Forbidden</Message></Response>");
  }

  try {
    const from = (req.body.From || "").slice(0, 50);
    const body = (req.body.Body || "").slice(0, 1600);
    const profileName = (req.body.ProfileName || "").slice(0, 100);

    console.log(`[WhatsApp] From: ${from}`);

    if (!from || !body) {
      res.setHeader("Content-Type", "text/xml");
      return res.status(400).send("<Response><Message>Invalid request</Message></Response>");
    }

    const phoneNumber = from.replace("whatsapp:", "");

    let replyText = "Thanks for contacting Paint Access! For immediate help, call us at 028-064-70-50 or visit paintaccess.com.au";

    try {
      const agentReply = await askElevenLabsTextAgent({
        text: body,
        channel: "whatsapp",
        customerName: profileName || "",
        customerPhone: phoneNumber,
      });
      if (agentReply) replyText = agentReply;
    } catch (err) {
      console.error("ElevenLabs WhatsApp text agent error:", err.message);
    }

    // Respond with TwiML
    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send(
      `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${escapeXml(replyText)}</Message>
</Response>`
    );
  } catch (err) {
    console.error("WhatsApp webhook error:", err);
    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send(
      `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Sorry, we're experiencing a technical issue. Please call us at 028-064-70-50.</Message>
</Response>`
    );
  }
};

function escapeXml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
