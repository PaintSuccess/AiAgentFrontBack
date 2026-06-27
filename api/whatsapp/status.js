const { corsHeaders, cleanEnv, rateLimit } = require("../../lib/shopify");
const { verifyTwilioSignature } = require("../../lib/whatsapp");

const TWILIO_ACCOUNT_SID = cleanEnv("TWILIO_ACCOUNT_SID");
const TWILIO_AUTH_TOKEN = cleanEnv("TWILIO_AUTH_TOKEN");
const TWILIO_SMS_FROM = normalizePhoneEnv(
  cleanEnv("TWILIO_MOBILE_NUMBER") ||
    cleanEnv("TWILIO_PHONE_NUMBER") ||
    cleanEnv("TWILIO_SYDNEY_NUMBER")
);
const FAILOVER_ERROR_CODES = new Set(["63051", "63112"]);

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

function twilioAuthHeader() {
  return `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64")}`;
}

async function fetchTwilioMessage(messageSid) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !messageSid) return null;

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages/${encodeURIComponent(messageSid)}.json`,
    { headers: { Authorization: twilioAuthHeader() } }
  );
  if (!response.ok) return null;
  return response.json();
}

async function sendSmsFailover({ to, body, originalSid, errorCode }) {
  const smsTo = toE164AustralianMobile(to);
  if (!smsTo || !TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_SMS_FROM || !body) {
    return { sent: false, reason: "not_configured_or_not_au_mobile" };
  }

  const params = new URLSearchParams();
  params.set("To", smsTo);
  params.set("From", TWILIO_SMS_FROM);
  params.set(
    "Body",
    `Paint Access WhatsApp reply (sent by SMS because WhatsApp delivery failed): ${String(body).slice(0, 1400)}`
  );

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: twilioAuthHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("[WhatsApp Status] SMS failover failed:", data);
    return { sent: false, reason: "sms_failed", error: data.code || response.status };
  }

  console.log("[WhatsApp Status] SMS failover sent", {
    originalSid,
    smsSid: data.sid,
    to: smsTo,
    errorCode,
  });
  return { sent: true, sid: data.sid, status: data.status };
}

module.exports = async function handler(req, res) {
  corsHeaders(res, req);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (rateLimit(req, res)) return;

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

  let failover = null;
  if (
    ["failed", "undelivered"].includes(status) &&
    FAILOVER_ERROR_CODES.has(errorCode) &&
    /^whatsapp:/i.test(from) &&
    /^whatsapp:/i.test(to)
  ) {
    const failedMessage = await fetchTwilioMessage(messageSid);
    failover = await sendSmsFailover({
      to,
      body: failedMessage?.body || body.Body || "",
      originalSid: messageSid,
      errorCode,
    });
  }

  return res.status(200).json({ ok: true, failover });
};
