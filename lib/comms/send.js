/**
 * Shared outbound send service — the single path used by the agent inbox,
 * the ChatGPT MCP (later), and internal callers to send a message on a channel
 * and log it to the comms spine as one outbound record.
 *
 * Channels: sms | whatsapp  (email arrives in a later phase)
 */
const { cleanEnv } = require("../shopify");
const { sendWhatsAppMessage, normalizeE164 } = require("../whatsapp");
const store = require("./store");
const queries = require("./queries");
const waTemplates = require("./wa-templates");

function normalizePhoneEnv(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (!raw.startsWith("+")) return `+${raw.replace(/\D/g, "")}`;
  return `+${raw.replace(/\D/g, "")}`;
}

function statusCallbackUrl() {
  const base = (cleanEnv("PUBLIC_BASE_URL") || cleanEnv("BACKEND_URL") || "").replace(/\/$/, "");
  return base ? `${base}/api/twilio/status-callback` : "";
}

async function twilioSendSms({ to, body }) {
  const sid = cleanEnv("TWILIO_ACCOUNT_SID");
  const token = cleanEnv("TWILIO_AUTH_TOKEN");
  const from = normalizePhoneEnv(
    cleanEnv("TWILIO_MOBILE_NUMBER") ||
      cleanEnv("TWILIO_PHONE_NUMBER") ||
      cleanEnv("TWILIO_SYDNEY_NUMBER")
  );
  if (!sid || !token || !from) {
    const err = new Error("Twilio SMS is not configured.");
    err.statusCode = 503;
    throw err;
  }

  const params = new URLSearchParams();
  params.set("To", to);
  params.set("From", from);
  params.set("Body", String(body || "").slice(0, 1500));
  const cb = statusCallbackUrl();
  if (cb) params.set("StatusCallback", cb);

  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
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
    throw err;
  }
  return { id: data.sid, status: data.status, provider: "twilio" };
}

/**
 * Send an outbound message on a channel and record it. Throws on send failure
 * (the caller — an API endpoint — surfaces the error to the user); the store
 * write itself is fail-safe and won't throw.
 *
 * @returns {Promise<{id, status, provider, message}>}
 */
async function sendMessage({ channel, to, body, author = "human", media = null, template = null }) {
  const toE164 = normalizeE164(to);
  if (!toE164) {
    const err = new Error("A valid recipient phone number is required.");
    err.statusCode = 400;
    throw err;
  }

  // WhatsApp approved-template send (reopens a closed 24h window / cold number).
  if (channel === "whatsapp" && template) {
    return sendWhatsAppTemplate({ toE164, template, author });
  }

  if (!body && !media) {
    const err = new Error("Message body is required.");
    err.statusCode = 400;
    throw err;
  }

  let result;
  if (channel === "sms") {
    result = await twilioSendSms({ to: toE164, body });
  } else if (channel === "whatsapp") {
    const sent = await sendWhatsAppMessage({ to: toE164, body, media, type: media ? "media" : "text" });
    result = { id: sent?.id || null, status: sent?.status || "sent", provider: sent?.provider || "twilio" };
  } else {
    const err = new Error(`Unsupported channel: ${channel}`);
    err.statusCode = 400;
    throw err;
  }

  const logged = await store.recordOutbound({
    channel,
    toPhone: toE164,
    author,
    body: body || null,
    media,
    externalProvider: result.provider === "meta" ? "meta" : "twilio",
    externalId: result.id || "",
    status: result.status || "sent",
  });

  // A human replying auto-takes-over the thread so the AI stops auto-answering
  // this customer (rolling pause window; auto-hands back after inactivity).
  if (author === "human" && logged?.thread?.id) {
    await queries.humanTakeoverThread(logged.thread.id).catch(() => {});
  }

  return { ...result, message: logged?.message || null, threadId: logged?.thread?.id || null };
}

/** Send an approved WhatsApp template; log the rendered text so the thread reads normally. */
async function sendWhatsAppTemplate({ toE164, template, author }) {
  const tpl = await waTemplates.getTemplate(template.sid || template.name);
  if (!tpl) {
    const err = new Error("Template not found or not approved.");
    err.statusCode = 400;
    throw err;
  }
  const variables = template.variables || {};
  const sent = await sendWhatsAppMessage({
    to: toE164,
    type: "template",
    template: { contentSid: tpl.sid, variables },
  });
  const result = { id: sent?.id || null, status: sent?.status || "sent", provider: sent?.provider || "twilio" };

  const logged = await store.recordOutbound({
    channel: "whatsapp",
    toPhone: toE164,
    author,
    body: waTemplates.renderBody(tpl.body, variables),
    externalProvider: result.provider === "meta" ? "meta" : "twilio",
    externalId: result.id || "",
    status: result.status || "sent",
    metadata: { template: tpl.name, template_sid: tpl.sid, category: tpl.category },
  });
  if (author === "human" && logged?.thread?.id) {
    await queries.humanTakeoverThread(logged.thread.id).catch(() => {});
  }
  return { ...result, message: logged?.message || null, threadId: logged?.thread?.id || null, template: tpl.name };
}

module.exports = { sendMessage };
