/**
 * POST /api/comms/escalate — ElevenLabs server tool: `escalate_to_human`.
 * Called by the agent on any channel (voice/SMS/WhatsApp/widget) when a customer
 * asks to speak with a person. See lib/comms/handoff.js for the handoff logic.
 */
const { verifyAuth, corsHeaders, rateLimit, sanitizeInput } = require("../../lib/shopify");
const { escalateToHuman } = require("../../lib/comms/handoff");

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (await rateLimit(req, res)) return;

  if (!verifyAuth(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const result = await escalateToHuman({
      channel: sanitizeInput(body.channel, 20) || "chat",
      phone: body.customer_phone || body.phone,
      name: sanitizeInput(body.customer_name || body.name, 100),
      reason: sanitizeInput(body.reason, 300),
      preferred: sanitizeInput(body.preferred_method || body.preferred, 20),
    });
    return res.status(200).json(result);
  } catch (err) {
    console.error("[comms/escalate]", err.message);
    return res.status(err.statusCode || 500).json({ error: err.message || "Failed to escalate to a human." });
  }
};
