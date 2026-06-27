const crypto = require("crypto");
const { cleanEnv, corsHeaders, rateLimit } = require("../../lib/shopify");
const {
  baseDynamicVariables,
  getCustomerContextByPhone,
  normalizePhone,
} = require("../../lib/shopify-customer-context");

const AGENT_ID = cleanEnv("ELEVENLABS_AGENT_ID");
const WEBHOOK_TOKEN =
  cleanEnv("ELEVENLABS_TWILIO_PERSONALIZATION_TOKEN") ||
  cleanEnv("API_SECRET_TOKEN");

const DEFAULT_FIRST_MESSAGE =
  "Hi, I'm Jess from PaintAccess. I can help you find the right product, track your order, or answer painting and sprayer questions. How can I help today?";

function safeEqual(a, b) {
  if (!a || !b) return false;
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function isAuthorized(req) {
  if (!WEBHOOK_TOKEN) return true;
  const authHeader = String(req.headers.authorization || "");
  const token =
    String(req.headers["x-paintaccess-webhook-token"] || "").trim() ||
    String(req.headers["x-elevenlabs-webhook-token"] || "").trim() ||
    authHeader.replace(/^Bearer\s+/i, "").trim();
  return safeEqual(token, WEBHOOK_TOKEN);
}

function getParam(req, key) {
  return (
    req.body?.[key] ||
    req.query?.[key] ||
    req.body?.data?.[key] ||
    req.body?.metadata?.[key] ||
    ""
  );
}

function firstMessageFor(context) {
  if (context?.found && context.customer_first_name) {
    return `Hi ${context.customer_first_name}, I'm Jess from PaintAccess. I can help with products, sprayer questions, or recent order details after a quick security check. What would you like to know today?`;
  }
  return DEFAULT_FIRST_MESSAGE;
}

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (rateLimit(req, res)) return;

  if (!isAuthorized(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const callerId = normalizePhone(getParam(req, "caller_id") || getParam(req, "from"));
  const calledNumber = normalizePhone(getParam(req, "called_number") || getParam(req, "to"));
  const requestAgentId = getParam(req, "agent_id");

  if (AGENT_ID && requestAgentId && requestAgentId !== AGENT_ID) {
    return res.status(200).json({
      type: "conversation_initiation_client_data",
      dynamic_variables: baseDynamicVariables({
        channel: "phone",
        customer_phone: callerId,
      }),
    });
  }

  let context = null;
  try {
    context = callerId ? await getCustomerContextByPhone(callerId) : null;
  } catch (err) {
    console.error("[twilio-personalization] customer lookup failed:", err.message);
  }

  const dynamicVariables = {
    ...baseDynamicVariables({
      channel: "phone",
      customer_phone: callerId,
    }),
    ...(context?.dynamicVariables || {}),
    system_called_number: calledNumber,
    twilio_call_sid: getParam(req, "call_sid"),
  };

  return res.status(200).json({
    type: "conversation_initiation_client_data",
    conversation_config_override: {
      agent: {
        first_message: firstMessageFor(context),
        language: "en",
      },
    },
    dynamic_variables: dynamicVariables,
  });
};
