const crypto = require("crypto");
const { cleanEnv } = require("./shopify");

const DEFAULT_META_VERSION = "v23.0";

function getProvider(preferred) {
  const raw = String(preferred || cleanEnv("WHATSAPP_PROVIDER") || "").toLowerCase();
  if (raw === "meta" || raw === "cloud" || raw === "meta_cloud") return "meta";
  return "twilio";
}

function normalizeE164(value) {
  const raw = String(value || "").replace(/^whatsapp:/i, "").trim();
  const digits = raw.replace(/\D/g, "");
  if (!digits || digits.length < 8 || digits.length > 15) return "";
  return `+${digits}`;
}

function normalizeMetaRecipient(value) {
  return normalizeE164(value).replace(/^\+/, "");
}

function twilioWhatsAppAddress(value) {
  const raw = String(value || "").trim();
  if (/^whatsapp:/i.test(raw)) return raw;
  const phone = normalizeE164(raw);
  return phone ? `whatsapp:${phone}` : "";
}

function escapeXml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function twimlMessage(body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${escapeXml(body)}</Message>
</Response>`;
}

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
  const paramStr = sortedKeys.map((key) => key + params[key]).join("");
  const expected = crypto
    .createHmac("sha1", authToken)
    .update(url + paramStr)
    .digest("base64");

  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

function verifyMetaSignature(req) {
  const appSecret = cleanEnv("META_APP_SECRET");
  if (!appSecret) return true;

  const signature = String(req.headers["x-hub-signature-256"] || "");
  if (!signature.startsWith("sha256=")) return false;

  const rawBody =
    typeof req.rawBody === "string" || Buffer.isBuffer(req.rawBody)
      ? req.rawBody
      : typeof req.body === "string"
        ? req.body
        : "";

  if (!rawBody) {
    // Was previously `return true` (fail OPEN) -- the caller (api/whatsapp/inbound.js)
    // now always sets req.rawBody itself before calling this, since bodyParser is
    // disabled for that route specifically so the true raw bytes are available. If
    // rawBody is still empty here, something upstream regressed; fail closed.
    console.error("[WhatsApp Meta] Cannot verify signature without raw request body -- rejecting.");
    return false;
  }

  const expected = `sha256=${crypto
    .createHmac("sha256", appSecret)
    .update(rawBody)
    .digest("hex")}`;

  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

function parseTwilioInbound(body = {}) {
  const from = normalizeE164(body.From);
  const text = String(body.Body || "").trim().slice(0, 1600);
  const profileName = String(body.ProfileName || "").trim().slice(0, 100);

  if (!from && !text) return null;

  return {
    provider: "twilio",
    from,
    text,
    profileName,
    messageType: "text",
    raw: body,
  };
}

function textFromMetaMessage(message = {}) {
  if (message.type === "text") return message.text?.body || "";
  if (message.type === "button") return message.button?.text || message.button?.payload || "";
  if (message.type === "interactive") {
    return (
      message.interactive?.button_reply?.title ||
      message.interactive?.list_reply?.title ||
      message.interactive?.button_reply?.id ||
      message.interactive?.list_reply?.id ||
      ""
    );
  }
  return `[Customer sent a ${message.type || "media"} message]`;
}

function parseMetaInbound(body = {}) {
  if (body.object !== "whatsapp_business_account") return null;

  const changes = [];
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field === "messages") changes.push(change.value || {});
    }
  }

  for (const value of changes) {
    const message = value.messages?.[0];
    if (!message) continue;

    const contact = value.contacts?.find((item) => item.wa_id === message.from) || {};
    return {
      provider: "meta",
      from: normalizeE164(message.from),
      text: String(textFromMetaMessage(message)).trim().slice(0, 1600),
      profileName: String(contact.profile?.name || "").trim().slice(0, 100),
      messageType: message.type || "unknown",
      messageId: message.id || "",
      phoneNumberId: value.metadata?.phone_number_id || "",
      raw: message,
    };
  }

  return null;
}

function parseWhatsAppInbound(req) {
  const body = req.body || {};
  if (body.object === "whatsapp_business_account") return parseMetaInbound(body);
  if (body.From || body.MessageSid || body.SmsMessageSid) return parseTwilioInbound(body);
  return null;
}

async function sendWhatsAppMessage({
  to,
  body,
  type = "text",
  template,
  media,
  provider,
}) {
  const selectedProvider = getProvider(provider);
  if (selectedProvider === "meta") {
    return sendMetaWhatsApp({ to, body, type, template, media });
  }
  return sendTwilioWhatsApp({ to, body, type, template, media });
}

async function sendTwilioWhatsApp({ to, body, type, template, media }) {
  const accountSid = cleanEnv("TWILIO_ACCOUNT_SID");
  const authToken = cleanEnv("TWILIO_AUTH_TOKEN");
  const messagingServiceSid = cleanEnv("TWILIO_MESSAGING_SERVICE_SID");
  const from = twilioWhatsAppAddress(
    cleanEnv("TWILIO_WHATSAPP_NUMBER") || cleanEnv("TWILIO_WHATSAPP_FROM")
  );
  const recipient = twilioWhatsAppAddress(to);

  if (!accountSid || !authToken || !recipient || (!from && !messagingServiceSid)) {
    const err = new Error(
      "Twilio WhatsApp is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_WHATSAPP_NUMBER or TWILIO_MESSAGING_SERVICE_SID."
    );
    err.statusCode = 503;
    throw err;
  }

  const params = new URLSearchParams();
  params.set("To", recipient);
  if (messagingServiceSid) params.set("MessagingServiceSid", messagingServiceSid);
  else params.set("From", from);

  if (type === "template" && template?.contentSid) {
    params.set("ContentSid", template.contentSid);
    if (template.variables) params.set("ContentVariables", JSON.stringify(template.variables));
  } else if (body || !media?.url) {
    params.set("Body", String(body || "").slice(0, 1500));
  }

  if (media?.url) params.append("MediaUrl", media.url);

  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    }
  );

  const data = await parseJsonResponse(response);
  if (!response.ok) {
    const err = new Error(data.message || `Twilio WhatsApp failed with ${response.status}`);
    err.statusCode = response.status >= 500 ? 502 : 400;
    err.upstream = data;
    throw err;
  }

  return {
    provider: "twilio",
    id: data.sid,
    status: data.status,
    raw: data,
  };
}

async function sendMetaWhatsApp({ to, body, type, template, media }) {
  const accessToken = cleanEnv("META_WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = cleanEnv("META_WHATSAPP_PHONE_NUMBER_ID");
  const graphVersion = cleanEnv("META_GRAPH_VERSION") || DEFAULT_META_VERSION;
  const recipient = normalizeMetaRecipient(to);

  if (!accessToken || !phoneNumberId || !recipient) {
    const err = new Error(
      "Meta WhatsApp is not configured. Set META_WHATSAPP_ACCESS_TOKEN and META_WHATSAPP_PHONE_NUMBER_ID."
    );
    err.statusCode = 503;
    throw err;
  }

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: recipient,
  };

  if (type === "template") {
    payload.type = "template";
    payload.template = {
      name: template?.name,
      language: { code: template?.language || "en" },
      ...(template?.components ? { components: template.components } : {}),
    };
  } else if (media?.type && (media.id || media.url)) {
    payload.type = media.type;
    payload[media.type] = media.id
      ? { id: media.id, ...(media.caption ? { caption: media.caption } : {}) }
      : { link: media.url, ...(media.caption ? { caption: media.caption } : {}) };
  } else {
    payload.type = "text";
    payload.text = {
      preview_url: false,
      body: String(body || "").slice(0, 4096),
    };
  }

  const response = await fetch(
    `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );

  const data = await parseJsonResponse(response);
  if (!response.ok) {
    const err = new Error(data.error?.message || `Meta WhatsApp failed with ${response.status}`);
    err.statusCode = response.status >= 500 ? 502 : 400;
    err.upstream = data;
    throw err;
  }

  return {
    provider: "meta",
    id: data.messages?.[0]?.id || null,
    status: data.messages?.[0]?.message_status || "accepted",
    raw: data,
  };
}

async function parseJsonResponse(response) {
  const raw = await response.text();
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return { message: raw };
  }
}

module.exports = {
  getProvider,
  normalizeE164,
  parseWhatsAppInbound,
  sendWhatsAppMessage,
  twimlMessage,
  verifyMetaSignature,
  verifyTwilioSignature,
};
