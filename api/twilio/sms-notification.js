const {
  corsHeaders,
  verifyAuth,
  rateLimit,
  sanitizeInput,
  cleanEnv,
} = require("../../lib/shopify");

const TWILIO_ACCOUNT_SID = cleanEnv("TWILIO_ACCOUNT_SID");
const TWILIO_AUTH_TOKEN = cleanEnv("TWILIO_AUTH_TOKEN");
const TWILIO_SMS_FROM = normalizePhoneEnv(
  cleanEnv("TWILIO_MOBILE_NUMBER") ||
    cleanEnv("TWILIO_PHONE_NUMBER") ||
    cleanEnv("TWILIO_SYDNEY_NUMBER")
);

const ALLOWED_LINK_HOSTS = new Set([
  "paintaccess.com.au",
  "www.paintaccess.com.au",
]);

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

function extractUrls(text) {
  return String(text || "").match(/https?:\/\/[^\s)>\]]+/gi) || [];
}

function hasOnlyAllowedLinks(text) {
  return extractUrls(text).every((urlText) => {
    try {
      const url = new URL(urlText);
      return ALLOWED_LINK_HOSTS.has(url.hostname.toLowerCase());
    } catch {
      return false;
    }
  });
}

async function sendTwilioSms({ to, body }) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_SMS_FROM) {
    const err = new Error("Twilio SMS is not configured.");
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

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!verifyAuth(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (rateLimit(req, res)) return;

  try {
    const to = toE164AustralianMobile(req.body?.to);
    const message = sanitizeInput(req.body?.message, 1200);

    if (!to) {
      return res.status(400).json({
        sent: false,
        reason: "mobile_required",
        message: "Please provide an Australian mobile number starting with 04 or +614.",
      });
    }

    if (!message) {
      return res.status(400).json({
        sent: false,
        reason: "message_required",
        message: "SMS message is required.",
      });
    }

    if (!hasOnlyAllowedLinks(message)) {
      return res.status(400).json({
        sent: false,
        reason: "unsupported_link",
        message: "SMS links must point to paintaccess.com.au.",
      });
    }

    const body = message.startsWith("Paint Access:")
      ? message
      : `Paint Access: ${message}`;
    const twilioMessage = await sendTwilioSms({ to, body });

    return res.status(200).json({
      sent: true,
      to,
      sid: twilioMessage.sid,
      status: twilioMessage.status,
      message: "SMS sent successfully.",
    });
  } catch (err) {
    console.error("[SMS Notification] Error:", err.message);
    return res.status(err.statusCode || 500).json({
      sent: false,
      error:
        err.statusCode === 503
          ? "SMS sending is not configured."
          : "SMS could not be sent.",
      code: err.twilioCode || undefined,
    });
  }
};
