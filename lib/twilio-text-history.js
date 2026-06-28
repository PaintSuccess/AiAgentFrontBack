const { cleanEnv } = require("./shopify");
const { normalizePhone } = require("./shopify-customer-context");

const TWILIO_ACCOUNT_SID = cleanEnv("TWILIO_ACCOUNT_SID");
const TWILIO_AUTH_TOKEN = cleanEnv("TWILIO_AUTH_TOKEN");
const TWILIO_SMS_FROM = normalizePhoneEnv(
  cleanEnv("TWILIO_MOBILE_NUMBER") ||
    cleanEnv("TWILIO_PHONE_NUMBER") ||
    cleanEnv("TWILIO_SYDNEY_NUMBER")
);
const TWILIO_WHATSAPP_FROM = twilioWhatsAppAddress(
  cleanEnv("TWILIO_WHATSAPP_NUMBER") ||
    cleanEnv("TWILIO_WHATSAPP_FROM")
);
const TWILIO_HISTORY_LOOKUP_TIMEOUT_MS = 2500;

function normalizePhoneEnv(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (!raw.startsWith("+")) return raw;
  return `+${raw.replace(/\D/g, "")}`;
}

function twilioWhatsAppAddress(value) {
  const phone = normalizePhone(value);
  return phone ? `whatsapp:${phone}` : "";
}

function twilioAuthHeader() {
  return `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64")}`;
}

function messageTime(message) {
  const value = message.date_sent || message.date_created || message.date_updated;
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function messageChannel(message) {
  return /whatsapp:/i.test(`${message.from || ""} ${message.to || ""}`) ? "WhatsApp" : "SMS";
}

function cleanHistoryText(message) {
  const body = String(message.body || "").trim();
  if (/^Paint Access WhatsApp reply \(sent by SMS because WhatsApp delivery failed\):/i.test(body)) {
    return "";
  }
  return body;
}

function messageRole(message, customerPhone) {
  const from = normalizePhone(message.from);
  return from && from === customerPhone ? "customer" : "agent";
}

async function fetchTwilioMessages(params) {
  const query = new URLSearchParams({ PageSize: "20", ...params });
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

function uniquePairs(pairs) {
  const seen = new Set();
  return pairs.filter((pair) => {
    const key = `${pair.From || ""}|${pair.To || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function loadTwilioTextHistory({
  customerPhone,
  currentSid = "",
  currentFrom = "",
  currentTo = "",
} = {}) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) return [];

  const customer = normalizePhone(customerPhone || currentFrom);
  if (!customer) return [];

  const customerSms = customer;
  const customerWhatsApp = `whatsapp:${customer}`;
  const currentWhatsAppBusiness =
    /^whatsapp:/i.test(currentTo) ? currentTo : /^whatsapp:/i.test(currentFrom) ? currentFrom : "";

  const pairs = uniquePairs([
    TWILIO_SMS_FROM && { From: customerSms, To: TWILIO_SMS_FROM },
    TWILIO_SMS_FROM && { From: TWILIO_SMS_FROM, To: customerSms },
    (TWILIO_WHATSAPP_FROM || currentWhatsAppBusiness) && {
      From: customerWhatsApp,
      To: TWILIO_WHATSAPP_FROM || currentWhatsAppBusiness,
    },
    (TWILIO_WHATSAPP_FROM || currentWhatsAppBusiness) && {
      From: TWILIO_WHATSAPP_FROM || currentWhatsAppBusiness,
      To: customerWhatsApp,
    },
    currentFrom && currentTo && { From: currentFrom, To: currentTo },
    currentFrom && currentTo && { From: currentTo, To: currentFrom },
  ].filter(Boolean));

  const results = await Promise.allSettled(pairs.map((pair) => fetchTwilioMessages(pair)));
  const bySid = new Map();
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const message of result.value) {
      if (!message.sid || message.sid === currentSid) continue;
      if (!cleanHistoryText(message)) continue;

      const status = String(message.status || "").toLowerCase();
      const role = messageRole(message, customer);
      if (role === "agent" && ["failed", "undelivered"].includes(status)) continue;

      bySid.set(message.sid, message);
    }
  }

  return [...bySid.values()]
    .sort((a, b) => messageTime(a) - messageTime(b))
    .slice(-12)
    .map((message) => ({
      role: messageRole(message, customer),
      channel: messageChannel(message),
      text: cleanHistoryText(message),
    }));
}

module.exports = {
  loadTwilioTextHistory,
};
