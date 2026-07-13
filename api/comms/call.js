/**
 * POST /api/comms/call — place an outbound recorded AI call to a customer.
 * Body: { threadId, to? }  — recipient resolved from the thread's contact unless
 * `to` is given. Recording + transcript flow back via the ElevenLabs post-call
 * webhook into the conversation thread.
 */
const { requireDashboardAuth } = require("../../lib/dashboard-auth");
const { startOutboundCall } = require("../../lib/comms/call");
const queries = require("../../lib/comms/queries");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = requireDashboardAuth(req, res);
  if (!session) return;

  const body = req.body || {};
  try {
    let to = body.to;
    let name, email, shopifyCustomerId;
    if (body.threadId) {
      const data = await queries.getThread(String(body.threadId));
      if (!data) return res.status(404).json({ error: "Thread not found" });
      const c = data.thread.contact || {};
      to = to || c.phone;
      name = c.name;
      email = c.email;
      shopifyCustomerId = c.shopify_customer_id;
    }
    if (!to) return res.status(400).json({ error: "No phone number for this contact" });

    const result = await startOutboundCall({ to, name, email, shopifyCustomerId });
    return res.status(200).json({ ok: true, result });
  } catch (err) {
    console.error("[comms/call]", err.message);
    return res.status(err.statusCode || 500).json({ error: err.message || "Failed to place call" });
  }
};
