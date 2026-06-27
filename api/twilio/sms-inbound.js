const crypto = require("crypto");
const { corsHeaders, rateLimit, cleanEnv } = require("../../lib/shopify");
const { askElevenLabsTextAgent } = require("../../lib/elevenlabs-text");

const TWILIO_ACCOUNT_SID = cleanEnv("TWILIO_ACCOUNT_SID");
const TWILIO_AUTH_TOKEN = cleanEnv("TWILIO_AUTH_TOKEN");
const TWILIO_SMS_FROM = normalizePhoneEnv(
  cleanEnv("TWILIO_MOBILE_NUMBER") ||
    cleanEnv("TWILIO_PHONE_NUMBER") ||
    cleanEnv("TWILIO_SYDNEY_NUMBER")
);
const TWILIO_HISTORY_LOOKUP_TIMEOUT_MS = 2500;

function normalizePhoneEnv(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (!raw.startsWith("+")) return raw;
  return `+${raw.replace(/\D/g, "")}`;
}

// Validate Twilio webhook signature to prevent spoofed requests
function verifyTwilioSignature(req) {
  const authToken = cleanEnv("TWILIO_AUTH_TOKEN");
  if (!authToken) return true; // Skip if not configured (dev mode)

  const signature = req.headers["x-twilio-signature"];
  if (!signature) return false;

  // Build the full URL Twilio used to sign
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const url = `${proto}://${host}${req.url}`;

  // Sort POST params and append to URL
  const params = req.body || {};
  const sortedKeys = Object.keys(params).sort();
  const paramStr = sortedKeys.map((k) => k + params[k]).join("");
  const data = url + paramStr;

  const expected = crypto
    .createHmac("sha1", authToken)
    .update(data)
    .digest("base64");

  // Timing-safe comparison
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
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

async function loadSmsConversationHistory({ from, to, currentSid }) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !from) return [];

  const businessNumber = normalizePhoneEnv(to) || TWILIO_SMS_FROM;
  if (!businessNumber) return [];

  const [inbound, outbound] = await Promise.all([
    fetchTwilioMessages({ From: from, To: businessNumber }),
    fetchTwilioMessages({ From: businessNumber, To: from }),
  ]);

  return [...inbound, ...outbound]
    .filter((message) => message.sid !== currentSid)
    .filter((message) => String(message.body || "").trim())
    .sort((a, b) => messageTime(a) - messageTime(b))
    .slice(-12)
    .map((message) => ({
      role: String(message.direction || "").startsWith("outbound") ? "agent" : "customer",
      text: message.body,
    }));
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
    const from = (req.body.From || "").slice(0, 30);
    const to = (req.body.To || "").slice(0, 30);
    const messageSid = (req.body.MessageSid || req.body.SmsSid || "").slice(0, 60);
    const body = (req.body.Body || "").slice(0, 1600);

    console.log(`[SMS] From: ${from}`);

    if (!from || !body) {
      return res.status(400).send("<Response><Message>Invalid request</Message></Response>");
    }

    let replyText = "Thanks for contacting Paint Access! We're processing your message. For immediate help, call us at 02 5838 5959 or visit paintaccess.com.au";
    let conversationHistory = [];

    try {
      conversationHistory = await loadSmsConversationHistory({
        from,
        to,
        currentSid: messageSid,
      });
    } catch (err) {
      console.error("[SMS] Conversation history lookup failed:", err.message);
    }

    try {
      const agentReply = await askElevenLabsTextAgent({
        text: body,
        channel: "sms",
        customerPhone: from,
        conversationHistory,
      });
      if (agentReply) replyText = agentReply;
    } catch (err) {
      console.error("ElevenLabs SMS text agent error:", err.message);
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
    console.error("SMS webhook error:", err);
    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send(
      `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Sorry, we're experiencing a technical issue. Please call us at 02 5838 5959.</Message>
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
