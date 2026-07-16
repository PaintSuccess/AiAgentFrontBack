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

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (await rateLimit(req, res)) return;

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

  // NO conversation_config_override. The agent's overrides allowlist
  // (platform_settings.overrides) has agent.first_message = false and agent.language =
  // false, so sending either one makes ElevenLabs reject the WHOLE conversation:
  //   status=failed, 0 turns, "Override for field 'first_message' is not allowed by config."
  // The caller hears nothing and hangs up. Every inbound call was failing this way.
  //
  // We greet by name through the dynamic variable instead: the agent's own first_message
  // is "Hi{{customer_greeting}}, I'm Jess from PaintAccess...", and getCustomerContextByPhone
  // already sets customer_greeting to " <FirstName>" (or "" when unknown), so phone now
  // personalises the same way the widget and SMS/WhatsApp do — one template, no override.
  // agent.language is already "en" on the agent, so dropping that override changes nothing.
  return res.status(200).json({
    type: "conversation_initiation_client_data",
    dynamic_variables: dynamicVariables,
  });
};
