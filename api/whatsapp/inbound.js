const { corsHeaders, rateLimit, cleanEnv } = require("../../lib/shopify");
const { askElevenLabsTextAgent } = require("../../lib/elevenlabs-text");
const { upsertWhatsAppLead } = require("../../lib/shopify-whatsapp-leads");
const { getCustomerContextByPhone } = require("../../lib/shopify-customer-context");
const { loadTwilioTextHistory } = require("../../lib/twilio-text-history");
const commsStore = require("../../lib/comms/store");
const commsQueries = require("../../lib/comms/queries");
const commsConsent = require("../../lib/comms/consent");
const linkToken = require("../../lib/comms/link-token");
const metaCapi = require("../../lib/comms/meta-capi");
const { isStaffNumber } = require("../../lib/comms/handoff");
const commsRelay = require("../../lib/comms/relay");
const {
  parseWhatsAppInbound,
  sendWhatsAppMessage,
  twimlMessage,
  verifyMetaSignature,
  verifyTwilioSignature,
} = require("../../lib/whatsapp");

function fallbackReply() {
  return "Thanks for contacting Paint Access. I can help with products, stock, orders, or painting advice. For urgent help, call 02 5838 5959.";
}

// bodyParser is disabled for this route (see module.exports.config below) so Meta's
// HMAC signature can be verified against the exact raw bytes it was computed over --
// Vercel's automatic JSON parsing discards those before user code ever sees the
// request, which is what let verifyMetaSignature's rawBody fallback fail open.
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Populates req.rawBody / req.body ourselves, matching the shape Vercel's built-in
// parser used to provide, so verifyTwilioSignature/verifyMetaSignature/parseWhatsAppInbound
// (all in lib/whatsapp.js) need no changes: Twilio sends form-urlencoded (parsed to a
// plain object, same as before), Meta sends JSON (parsed to an object for downstream
// use, with the exact raw string kept on req.rawBody for signature verification).
async function populateRequestBody(req) {
  const rawBodyBuffer = await readRawBody(req);
  const rawBodyText = rawBodyBuffer.toString("utf8");
  const contentType = String(req.headers["content-type"] || "");
  req.rawBody = rawBodyText;

  if (contentType.includes("application/json")) {
    req.body = rawBodyText ? JSON.parse(rawBodyText) : {};
  } else if (contentType.includes("application/x-www-form-urlencoded")) {
    req.body = Object.fromEntries(new URLSearchParams(rawBodyText));
  } else {
    req.body = {};
  }
}

async function buildAgentReply(inbound, conversationHistory = [], customerContext = null) {
  const text =
    inbound.text ||
    `[Customer sent a ${inbound.messageType || "WhatsApp"} message. Ask them to send text if the attachment cannot be processed yet.]`;

  const prompt =
    inbound.messageType && inbound.messageType !== "text"
      ? `${text}\n\nReply as Jessica. Explain that the WhatsApp channel has received the attachment, but ask for a short text description so you can help immediately.`
      : text;

  const reply = await askElevenLabsTextAgent({
    text: prompt,
    channel: "whatsapp",
    customerName: customerContext?.customer_name || inbound.profileName || "",
    customerEmail: customerContext?.customer_email || "",
    customerPhone: inbound.from,
    customerContextSummary: customerContext?.customer_context_summary || "",
    customerId: customerContext?.customer_id || "",
    customerTags: customerContext?.customer_tags || "",
    customerRecentOrders: customerContext?.customer_recent_orders || "",
    customerOrders: customerContext?.recentOrders || [],
    conversationHistory,
    // Meta's Cloud API webhook also expects an ack within a short window before it
    // retries delivery; same reasoning as the SMS default in elevenlabs-text.js.
    timeoutMs: 14000,
  });

  return reply || fallbackReply();
}

module.exports = async function handler(req, res) {
  corsHeaders(res, req);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    const mode = req.query?.["hub.mode"];
    const token = req.query?.["hub.verify_token"];
    const challenge = req.query?.["hub.challenge"];
    const verifyToken = cleanEnv("META_WHATSAPP_VERIFY_TOKEN");

    if (mode === "subscribe" && token && verifyToken && token === verifyToken) {
      return res.status(200).send(challenge || "");
    }
    return res.status(403).send("Forbidden");
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (await rateLimit(req, res)) return;

  try {
    await populateRequestBody(req);
  } catch (err) {
    console.error("[WhatsApp] Failed to read/parse request body:", err.message);
    return res.status(400).json({ error: "Invalid request body" });
  }

  const inbound = parseWhatsAppInbound(req);
  if (!inbound) return res.status(400).json({ error: "Unsupported WhatsApp webhook payload" });

  if (inbound.provider === "twilio" && !verifyTwilioSignature(req)) {
    res.setHeader("Content-Type", "text/xml");
    return res.status(403).send(twimlMessage("Forbidden"));
  }

  if (inbound.provider === "meta" && !verifyMetaSignature(req)) {
    return res.status(403).json({ error: "Invalid Meta webhook signature" });
  }

  try {
    console.log(`[WhatsApp] ${inbound.provider} inbound from ${inbound.from}`);

    if (!inbound.from) {
      if (inbound.provider === "twilio") {
        res.setHeader("Content-Type", "text/xml");
        return res.status(400).send(twimlMessage("Invalid request"));
      }
      return res.status(400).json({ error: "Invalid request" });
    }

    // Staff messaging the business number — never route through the customer-facing
    // AI or create a customer thread. The relay router turns their message into a
    // customer reply / command; a WhatsApp quote-reply carries the mirrored message's
    // SID (OriginalRepliedMessageSid) which routes it to the right relay even with
    // several running at once. Fail-safe: a relay error still acks the webhook.
    if (isStaffNumber(inbound.from)) {
      console.log(`[WhatsApp] Staff number ${inbound.from} — routing to relay.`);
      await commsRelay
        .routeStaffMessage({
          fromE164: inbound.from,
          text: inbound.text,
          quotedSid: inbound.raw?.OriginalRepliedMessageSid || "",
          channel: "whatsapp",
          messageSid:
            inbound.provider === "meta"
              ? inbound.messageId
              : inbound.raw?.MessageSid || inbound.raw?.SmsMessageSid || "",
        })
        .catch((err) => console.error("[WhatsApp] relay staff routing failed:", err.message));
      if (inbound.provider === "twilio") {
        res.setHeader("Content-Type", "text/xml");
        return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>\n<Response></Response>`);
      }
      return res.status(200).json({ ok: true, staff: true });
    }

    try {
      await upsertWhatsAppLead({
        phone: inbound.from,
        profileName: inbound.profileName,
        message: inbound.text,
        provider: inbound.provider,
      });
    } catch (err) {
      console.error("[WhatsApp] Shopify lead sync failed:", err.message);
    }

    let replyText = fallbackReply();
    let conversationHistory = [];
    let customerContext = null;

    try {
      conversationHistory = await loadTwilioTextHistory({
        customerPhone: inbound.from,
        currentSid: inbound.raw?.MessageSid || inbound.raw?.SmsMessageSid || "",
        currentFrom: inbound.raw?.From || "",
        currentTo: inbound.raw?.To || "",
      });
    } catch (err) {
      console.error("[WhatsApp] Conversation history lookup failed:", err.message);
    }

    try {
      customerContext = await getCustomerContextByPhone(inbound.from);
    } catch (err) {
      console.error("[WhatsApp] Customer context lookup failed:", err.message);
    }

    // Persist the inbound WhatsApp message to the comms spine (fail-safe).
    const inboundRecord = await commsStore.recordInbound({
      channel: "whatsapp",
      fromPhone: inbound.from,
      body: inbound.text,
      externalProvider: inbound.provider === "meta" ? "meta" : "twilio",
      externalId:
        inbound.provider === "meta"
          ? inbound.messageId
          : inbound.raw?.MessageSid || inbound.raw?.SmsMessageSid || "",
      name: customerContext?.customer_name || inbound.profileName || "",
      email: customerContext?.customer_email || "",
      shopifyCustomerId: customerContext?.customer_id || "",
      // Click-to-WhatsApp ad attribution — arrives once, on the ad-click message only.
      referral: inbound.referral || null,
    });

    // Both Twilio and Meta retry a webhook that doesn't ack fast enough, re-delivering
    // the same message id. recordInbound already dedupes on (provider, externalId) — if
    // this exact message was already processed, don't call the LLM or send a second reply.
    if (inboundRecord && inboundRecord.isNew === false) {
      // A redelivery can mean the FIRST attempt timed out mid-work. Mirroring is
      // idempotent on the message id, so let the retry complete a relay mirror the
      // first attempt may not have finished; it no-ops when already mirrored.
      await commsRelay
        .mirrorCustomerMessage({
          threadId: inboundRecord?.thread?.id,
          body: inbound.text,
          name: inbound.profileName || "",
          inboundSid:
            inbound.provider === "meta"
              ? inbound.messageId
              : inbound.raw?.MessageSid || inbound.raw?.SmsMessageSid || "",
        })
        .catch(() => null);
      console.log(`[WhatsApp] Duplicate delivery — already answered, staying silent.`);
      if (inbound.provider === "twilio") {
        res.setHeader("Content-Type", "text/xml");
        return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>\n<Response></Response>`);
      }
      return res.status(200).json({ ok: true, duplicate: true });
    }

    // Ad-sourced conversation → report a lead back to Meta so the ad optimises on real
    // outcomes. Fires only when a ctwa_clid is present (inherently the first ad-click
    // message). No-ops until META_CAPI_ACCESS_TOKEN is set. Fail-safe: never blocks the reply.
    if (inbound.referral?.ctwa_clid) {
      metaCapi
        .sendConversion({ eventName: "LeadSubmitted", ctwaClid: inbound.referral.ctwa_clid })
        .then((r) => { if (r?.skipped) console.log(`[WhatsApp] Meta CAPI lead ${r.skipped}`); })
        .catch((err) => console.error("[WhatsApp] Meta CAPI lead failed:", err.message));
    }

    // Record STOP/START keyword opt-out/in (fail-safe).
    await commsConsent.applyKeywordConsent(inbound.from, "whatsapp", inbound.text);

    // Active relay on this thread → mirror the message to staff phones and stay
    // silent (the relay, not the 30-min takeover window, is the source of truth
    // while a human handoff is live). Fail-safe: errors fall through to the AI.
    const relayed = await commsRelay
      .mirrorCustomerMessage({
        threadId: inboundRecord?.thread?.id,
        body: inbound.text,
        name: customerContext?.customer_name || inbound.profileName || "",
        inboundSid:
          inbound.provider === "meta"
            ? inbound.messageId
            : inbound.raw?.MessageSid || inbound.raw?.SmsMessageSid || "",
      })
      .catch(() => null);
    if (relayed) {
      console.log(`[WhatsApp] Relay #${relayed.tag} — mirrored to staff, AI staying silent.`);
      if (inbound.provider === "twilio") {
        res.setHeader("Content-Type", "text/xml");
        return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>\n<Response></Response>`);
      }
      return res.status(200).json({ ok: true, relayed: true });
    }

    // AI-control gate: stay silent if a human is actively handling this thread
    // (auto-hands back to the AI once the takeover window lapses).
    const control = await commsQueries.evaluateInboundControl(inbound.from);
    if (control && control.aiEnabled === false) {
      console.log("[WhatsApp] Human is handling this thread — AI staying silent.");
      if (inbound.provider === "twilio") {
        res.setHeader("Content-Type", "text/xml");
        return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>\n<Response></Response>`);
      }
      return res.status(200).json({ ok: true, paused: true });
    }

    try {
      replyText = await buildAgentReply(inbound, conversationHistory, customerContext);
    } catch (err) {
      console.error("[WhatsApp] ElevenLabs text agent error:", err.message);
    }

    // Tag storefront links with this contact's signed token, so that when they tap one we can
    // tell WHO is browsing. Shopify's browse events carry no identity by design; because we
    // send this message, this is the one identity edge we control outright.
    // Best-effort: attribution must never cost a customer their reply.
    try {
      if (inboundRecord?.contact?.id) replyText = linkToken.tagLinks(replyText, inboundRecord.contact.id);
    } catch (err) {
      console.error("[WhatsApp] link tagging failed:", err.message);
    }

    if (inbound.provider === "twilio") {
      // TwiML reply — no Twilio SID available here.
      await commsStore.recordOutbound({
        channel: "whatsapp",
        toPhone: inbound.from,
        author: "ai",
        body: replyText,
        externalProvider: "twilio",
        status: "sent",
      });
      res.setHeader("Content-Type", "text/xml");
      return res.status(200).send(twimlMessage(replyText));
    }

    const sent = await sendWhatsAppMessage({
      to: inbound.from,
      body: replyText,
      provider: "meta",
    });

    await commsStore.recordOutbound({
      channel: "whatsapp",
      toPhone: inbound.from,
      author: "ai",
      body: replyText,
      externalProvider: "meta",
      externalId: sent?.id || "",
      status: sent?.status || "sent",
    });

    return res.status(200).json({ ok: true, sent });
  } catch (err) {
    console.error("[WhatsApp] Webhook error:", err);

    if (inbound.provider === "twilio") {
      res.setHeader("Content-Type", "text/xml");
      return res.status(200).send(twimlMessage(fallbackReply()));
    }

    return res.status(200).json({ ok: false, error: "Processing failed" });
  }
};

// Disable Vercel's automatic body parsing for this route -- see populateRequestBody
// above. api/twilio/whatsapp-inbound.js re-exports this same module, so this config
// applies to that route too.
module.exports.config = {
  api: {
    bodyParser: false,
  },
};
