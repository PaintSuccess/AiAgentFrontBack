const {
  corsHeaders,
  rateLimit,
  sanitizeInput,
  cleanEnv,
} = require("../../lib/shopify");
const { askElevenLabsTextAgent } = require("../../lib/elevenlabs-text");

const TWILIO_ACCOUNT_SID = cleanEnv("TWILIO_ACCOUNT_SID");
const TWILIO_AUTH_TOKEN = cleanEnv("TWILIO_AUTH_TOKEN");
const TWILIO_SMS_FROM = normalizePhoneEnv(
  cleanEnv("TWILIO_MOBILE_NUMBER") ||
    cleanEnv("TWILIO_PHONE_NUMBER") ||
    cleanEnv("TWILIO_SYDNEY_NUMBER")
);
const SMS_WINDOW_MS = 60 * 60 * 1000;
const SMS_IP_MAX = 10;
const SMS_PHONE_MAX = 3;
const smsLimiter = new Map();

function normalizePhoneEnv(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (!raw.startsWith("+")) return raw;
  return `+${raw.replace(/\D/g, "")}`;
}

function toE164AustralianMobile(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("6104")) digits = `614${digits.slice(4)}`;
  else if (digits.startsWith("04")) digits = `61${digits.slice(1)}`;
  else if (digits.startsWith("4") && digits.length === 9) digits = `61${digits}`;
  else if (digits.startsWith("614")) digits = digits;

  if (!/^614\d{8}$/.test(digits)) return "";
  return `+${digits}`;
}

function fallbackReply(firstName) {
  const greeting = firstName ? `Hi ${firstName},` : "Hi,";
  return `${greeting} this is Jessica from Paint Access. Thanks for reaching out. Reply to this SMS with your question and I can help with products, stock, orders, or painting advice.`;
}

function limitKey(kind, value) {
  return `${kind}:${value || "unknown"}`;
}

function isLimited(key, max) {
  const now = Date.now();
  const entry = smsLimiter.get(key);
  if (!entry || now - entry.t > SMS_WINDOW_MS) {
    smsLimiter.set(key, { t: now, n: 1 });
    return false;
  }
  entry.n += 1;
  return entry.n > max;
}

function smsRateLimit(req, phone) {
  const ip =
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    "unknown";

  return (
    isLimited(limitKey("ip", ip), SMS_IP_MAX) ||
    isLimited(limitKey("phone", phone), SMS_PHONE_MAX)
  );
}

async function sendTwilioSms({ to, body }) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_SMS_FROM) {
    const err = new Error(
      "Twilio SMS is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_MOBILE_NUMBER or TWILIO_PHONE_NUMBER."
    );
    err.statusCode = 503;
    throw err;
  }

  const params = new URLSearchParams();
  params.set("To", to);
  params.set("From", TWILIO_SMS_FROM);
  params.set("Body", body);

  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    }
  );

  const raw = await response.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { message: raw };
  }
  if (!response.ok) {
    const err = new Error(data.message || `Twilio SMS failed with ${response.status}`);
    err.statusCode = response.status >= 500 ? 502 : 400;
    err.twilioCode = data.code || null;
    throw err;
  }

  return data;
}

module.exports = async function handler(req, res) {
  corsHeaders(res, req);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (rateLimit(req, res)) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const firstName = sanitizeInput(body.first_name, 80);
    const lastName = sanitizeInput(body.last_name, 80);
    const email = sanitizeInput(body.email, 320);
    const message = sanitizeInput(body.message, 800);
    const to = toE164AustralianMobile(body.phone);

    if (!firstName || !lastName || !email || !to) {
      return res.status(400).json({
        error: "First name, last name, email, and a valid Australian mobile number are required.",
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Please enter a valid email address." });
    }

    if (smsRateLimit(req, to)) {
      return res.status(429).json({
        error: "Too many SMS requests. Please wait before trying again.",
      });
    }

    const customerName = `${firstName} ${lastName}`.trim();
    const prompt = message
      ? `Customer completed the website SMS form.\nName: ${customerName}\nEmail: ${email}\nPhone: ${to}\nMessage: ${message}\n\nSend a concise first SMS reply and invite them to continue by replying.`
      : `Customer completed the website SMS form.\nName: ${customerName}\nEmail: ${email}\nPhone: ${to}\n\nSend a concise welcome SMS and invite them to reply with their question.`;

    let smsBody = "";
    try {
      smsBody = await askElevenLabsTextAgent({
        text: prompt,
        channel: "sms",
        customerName,
        customerEmail: email,
        customerPhone: to,
      });
    } catch (err) {
      console.error("[SMS Send] ElevenLabs reply error:", err.message);
    }

    if (!smsBody) smsBody = fallbackReply(firstName);
    smsBody = smsBody.slice(0, 1500);

    const twilioMessage = await sendTwilioSms({ to, body: smsBody });
    console.log("[SMS Send] Sent:", twilioMessage.sid, "to", to);

    return res.status(200).json({
      ok: true,
      message: "Thanks! We sent an SMS to your mobile number.",
      sid: twilioMessage.sid,
      status: twilioMessage.status,
    });
  } catch (err) {
    console.error("[SMS Send] Error:", err.message);
    return res.status(err.statusCode || 500).json({
      error:
        err.statusCode === 503
          ? "SMS sending is not configured yet."
          : "We could not send the SMS. Please check the mobile number and try again.",
      code: err.twilioCode || undefined,
    });
  }
};
