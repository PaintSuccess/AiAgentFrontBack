const {
  corsHeaders,
  rateLimit,
  checkRateLimit,
  sanitizeInput,
  cleanEnv,
  shopifyFetch,
} = require("../../lib/shopify");
const { askElevenLabsTextAgent } = require("../../lib/elevenlabs-text");
const commsStore = require("../../lib/comms/store");

const TWILIO_ACCOUNT_SID = cleanEnv("TWILIO_ACCOUNT_SID");
const TWILIO_AUTH_TOKEN = cleanEnv("TWILIO_AUTH_TOKEN");
const PUBLIC_BASE_URL = (cleanEnv("PUBLIC_BASE_URL") || cleanEnv("BACKEND_URL") || "").replace(/\/$/, "");
const STATUS_CALLBACK_URL = PUBLIC_BASE_URL ? `${PUBLIC_BASE_URL}/api/twilio/status-callback` : "";
const TWILIO_SMS_FROM = normalizePhoneEnv(
  cleanEnv("TWILIO_MOBILE_NUMBER") ||
    cleanEnv("TWILIO_PHONE_NUMBER") ||
    cleanEnv("TWILIO_SYDNEY_NUMBER")
);
const SMS_WINDOW_SECONDS = 60 * 60;
const SMS_IP_MAX = 10;
const SMS_PHONE_MAX = 3;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{1,63}$/;

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

function isPhoneValidationError(err) {
  const upstream = String(err?.upstream || "");
  return err?.statusCode === 422 && /"phone"\s*:/i.test(upstream);
}

function isEmailTakenError(err) {
  const upstream = String(err?.upstream || "");
  return err?.statusCode === 422 && /"email"\s*:\s*\[.*already been taken/i.test(upstream);
}

async function createSmsLead({ firstName, lastName, email, phone, message }) {
  const cleanEmail = String(email || "").toLowerCase();
  if (!EMAIL_RE.test(cleanEmail)) {
    return { action: "skipped", reason: "invalid_email" };
  }

  const search = await shopifyFetch(
    `customers/search.json?query=email:${encodeURIComponent(cleanEmail)}&limit=1`
  );
  const existing = search.customers?.[0];
  if (existing) {
    console.log("[SMS Send] Existing customer left untouched:", existing.id);
    return {
      action: "skipped",
      reason: "existing_customer_unverified",
      customer_id: existing.id,
    };
  }

  const note = [
    "SMS form request via AI widget",
    message ? `Message: ${message}` : null,
  ].filter(Boolean).join(" | ");

  const customerPayload = {
    first_name: firstName,
    last_name: lastName,
    email: cleanEmail,
    ...(phone ? { phone } : {}),
    tags: "AI Agent,ai-lead,ai-widget,sms-form",
    note,
    accepts_marketing: false,
    verified_email: false,
  };

  try {
    const created = await shopifyFetch("customers.json", {
      method: "POST",
      body: JSON.stringify({ customer: customerPayload }),
    });
    console.log("[SMS Send] Customer created:", created.customer?.id);
    return { action: "created", customer_id: created.customer?.id };
  } catch (err) {
    if (isEmailTakenError(err)) {
      return { action: "skipped", reason: "existing_customer_unverified" };
    }
    if (!isPhoneValidationError(err) || !phone) throw err;

    delete customerPayload.phone;
    try {
      const created = await shopifyFetch("customers.json", {
        method: "POST",
        body: JSON.stringify({ customer: customerPayload }),
      });
      console.log("[SMS Send] Customer created without phone:", created.customer?.id);
      return { action: "created", customer_id: created.customer?.id };
    } catch (retryErr) {
      if (isEmailTakenError(retryErr)) {
        return { action: "skipped", reason: "existing_customer_unverified" };
      }
      throw retryErr;
    }
  }
}

function limitKey(kind, value) {
  return `${kind}:${value || "unknown"}`;
}

async function smsRateLimit(req, phone) {
  const ip =
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    "unknown";

  const [ipLimited, phoneLimited] = await Promise.all([
    checkRateLimit(limitKey("ip", ip), SMS_IP_MAX, SMS_WINDOW_SECONDS),
    checkRateLimit(limitKey("phone", phone), SMS_PHONE_MAX, SMS_WINDOW_SECONDS),
  ]);
  return ipLimited || phoneLimited;
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
  if (STATUS_CALLBACK_URL) params.set("StatusCallback", STATUS_CALLBACK_URL);

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
  if (await rateLimit(req, res)) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const firstName = sanitizeInput(body.first_name, 80);
    const lastName = sanitizeInput(body.last_name, 80);
    const email = sanitizeInput(body.email, 320).toLowerCase();
    const message = sanitizeInput(body.message, 800);
    const to = toE164AustralianMobile(body.phone);

    if (!firstName || !lastName || !email || !to) {
      return res.status(400).json({
        error: "First name, last name, email, and a valid Australian mobile number are required.",
      });
    }

    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "Please enter a valid email address." });
    }

    if (await smsRateLimit(req, to)) {
      return res.status(429).json({
        error: "Too many SMS requests. Please wait before trying again.",
      });
    }

    let leadResult = { action: "not_attempted" };
    try {
      leadResult = await createSmsLead({
        firstName,
        lastName,
        email,
        phone: to,
        message,
      });
    } catch (err) {
      console.error("[SMS Send] Customer create error:", err.message);
      leadResult = { action: "skipped", reason: "shopify_error" };
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

    // Persist the outbound message to the comms spine (fail-safe).
    //
    // NOTE: `email` is deliberately NOT passed as an identity field. This endpoint is a
    // public, unauthenticated form, so the address is whatever the sender typed — it is
    // a lead detail, not proof of identity. resolveContact() resolves by phone and then
    // falls back to matching on email, and back-fills any missing field on whatever it
    // matched. Passing an unverified email would therefore let anyone bind THEIR phone
    // number to a stranger's contact by typing that stranger's address, and drop this
    // message into their thread — after which a staff reply from that thread goes to
    // the wrong person. The phone is the identity here (it's what we texted); the
    // address is preserved on the Shopify lead above and in metadata for staff.
    await commsStore.recordOutbound({
      channel: "sms",
      toPhone: to,
      author: "ai",
      body: smsBody,
      externalProvider: "twilio",
      externalId: twilioMessage.sid,
      status: twilioMessage.status || "queued",
      name: customerName,
      metadata: { form_email: email },
    });

    return res.status(200).json({
      ok: true,
      message: "Thanks! We sent an SMS to your mobile number.",
      sid: twilioMessage.sid,
      status: twilioMessage.status,
      lead: leadResult,
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
