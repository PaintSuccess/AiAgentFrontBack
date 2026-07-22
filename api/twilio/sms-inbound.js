const crypto = require("crypto");
const { corsHeaders, rateLimit, cleanEnv } = require("../../lib/shopify");
const { askElevenLabsTextAgent } = require("../../lib/elevenlabs-text");
const { getCustomerContextByPhone } = require("../../lib/shopify-customer-context");
const { loadTwilioTextHistory } = require("../../lib/twilio-text-history");
const commsStore = require("../../lib/comms/store");
const commsQueries = require("../../lib/comms/queries");
const commsConsent = require("../../lib/comms/consent");
const { isStaffNumber } = require("../../lib/comms/handoff");
const commsRelay = require("../../lib/comms/relay");

// Validate Twilio webhook signature to prevent spoofed requests
function verifyTwilioSignature(req) {
  const authToken = cleanEnv("TWILIO_AUTH_TOKEN");
  // Fail CLOSED (matches lib/whatsapp.js, hardened earlier for the same reason):
  // a missing secret is a config outage, not permission to skip auth. This matters
  // more now that a forged From equal to a staff number would reach the relay
  // router and could send human-authored messages to customers.
  if (!authToken) {
    console.error("[SMS] TWILIO_AUTH_TOKEN is not set -- rejecting unverifiable webhook.");
    return false;
  }

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

module.exports = async function handler(req, res) {
  corsHeaders(res, req);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (await rateLimit(req, res)) return;

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

    // Staff texting the business number — never route through the customer-facing
    // AI or create a customer thread. The relay router turns their message into a
    // customer reply / command; with no active relays it just tells them so.
    // Fail-safe: a relay error still acks the webhook (Twilio must not retry).
    if (isStaffNumber(from)) {
      console.log(`[SMS] Staff number ${from} — routing to relay.`);
      await commsRelay
        .routeStaffMessage({ fromE164: from, text: body, quotedSid: "", channel: "sms", messageSid })
        .catch((err) => console.error("[SMS] relay staff routing failed:", err.message));
      res.setHeader("Content-Type", "text/xml");
      return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>\n<Response></Response>`);
    }

    let replyText = "Thanks for contacting Paint Access! We're processing your message. For immediate help, call us at 02 5838 5959 or visit paintaccess.com.au";
    let conversationHistory = [];
    let customerContext = null;

    try {
      conversationHistory = await loadTwilioTextHistory({
        customerPhone: from,
        currentSid: messageSid,
        currentFrom: from,
        currentTo: to,
      });
    } catch (err) {
      console.error("[SMS] Conversation history lookup failed:", err.message);
    }

    try {
      customerContext = await getCustomerContextByPhone(from);
    } catch (err) {
      console.error("[SMS] Customer context lookup failed:", err.message);
    }

    // Persist the inbound customer message to the comms spine (fail-safe).
    const inboundRecord = await commsStore.recordInbound({
      channel: "sms",
      fromPhone: from,
      toPhone: to,
      body,
      externalProvider: "twilio",
      externalId: messageSid,
      name: customerContext?.customer_name || "",
      email: customerContext?.customer_email || "",
      shopifyCustomerId: customerContext?.customer_id || "",
    });

    // Twilio retries a webhook that doesn't ack fast enough, re-delivering the same
    // MessageSid. recordInbound already dedupes on (provider, externalId) — if this
    // exact message was already processed, don't call the LLM or send a second reply.
    if (inboundRecord && inboundRecord.isNew === false) {
      // A redelivery can mean the FIRST attempt timed out mid-work. Mirroring is
      // idempotent on messageSid, so let the retry complete a relay mirror the
      // first attempt may not have finished; it no-ops when already mirrored.
      await commsRelay
        .mirrorCustomerMessage({ threadId: inboundRecord?.thread?.id, body, name: "", inboundSid: messageSid })
        .catch(() => null);
      console.log(`[SMS] Duplicate delivery of ${messageSid} — already answered, staying silent.`);
      res.setHeader("Content-Type", "text/xml");
      return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>\n<Response></Response>`);
    }

    // Record STOP/START keyword opt-out/in (fail-safe).
    await commsConsent.applyKeywordConsent(from, "sms", body);

    // Active relay on this thread → mirror the message to staff phones and stay
    // silent (the relay, not the 30-min takeover window, is the source of truth
    // while a human handoff is live). Fail-safe: errors fall through to the AI.
    const relayed = await commsRelay
      .mirrorCustomerMessage({
        threadId: inboundRecord?.thread?.id,
        body,
        name: customerContext?.customer_name || "",
        inboundSid: messageSid,
      })
      .catch(() => null);
    if (relayed) {
      console.log(`[SMS] Relay #${relayed.tag} — mirrored to staff, AI staying silent.`);
      res.setHeader("Content-Type", "text/xml");
      return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>\n<Response></Response>`);
    }

    // AI-control gate: stay silent if a human is actively handling this thread
    // (auto-hands back to the AI once the takeover window lapses).
    const control = await commsQueries.evaluateInboundControl(from);
    if (control && control.aiEnabled === false) {
      console.log("[SMS] Human is handling this thread — AI staying silent.");
      res.setHeader("Content-Type", "text/xml");
      return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>\n<Response></Response>`);
    }

    try {
      const agentReply = await askElevenLabsTextAgent({
        text: body,
        channel: "sms",
        customerPhone: from,
        customerName: customerContext?.customer_name || "",
        customerEmail: customerContext?.customer_email || "",
        customerContextSummary: customerContext?.customer_context_summary || "",
        customerId: customerContext?.customer_id || "",
        customerTags: customerContext?.customer_tags || "",
        customerRecentOrders: customerContext?.customer_recent_orders || "",
        customerOrders: customerContext?.recentOrders || [],
        conversationHistory,
      });
      if (agentReply) replyText = agentReply;
    } catch (err) {
      console.error("ElevenLabs SMS text agent error:", err.message);
    }

    // Persist the outbound AI reply. Sent via TwiML, so there is no Twilio SID here
    // (Phase 2's async REST send will supply one for delivery tracking).
    await commsStore.recordOutbound({
      channel: "sms",
      toPhone: from,
      author: "ai",
      body: replyText,
      externalProvider: "twilio",
      status: "sent",
    });

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
