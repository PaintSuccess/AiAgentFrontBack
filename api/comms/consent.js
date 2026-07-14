/**
 * POST /api/comms/consent — set a contact's per-channel marketing consent.
 * Body: { threadId? | contactId?, channel: "email"|"sms"|"whatsapp"|"calls",
 *         status: "subscribed"|"not_subscribed"|"unsubscribed" }
 * Email/SMS are written back to the Shopify customer.
 */
const { requireDashboardAuth } = require("../../lib/dashboard-auth");
const { setConsent } = require("../../lib/comms/consent");
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
  const channel = String(body.channel || "").toLowerCase();
  const status = String(body.status || "").toLowerCase();
  if (!["email", "sms", "whatsapp", "calls"].includes(channel)) {
    return res.status(400).json({ error: "Invalid channel" });
  }

  try {
    let contactId = body.contactId;
    if (!contactId && body.threadId) {
      const d = await queries.getThread(String(body.threadId));
      if (!d) return res.status(404).json({ error: "Thread not found" });
      contactId = d.thread.contact?.id;
    }
    if (!contactId) return res.status(400).json({ error: "Missing contactId or threadId" });

    const result = await setConsent({ contactId, channel, status });
    return res.status(200).json(result);
  } catch (err) {
    console.error("[comms/consent]", err.message);
    return res.status(err.statusCode || 500).json({ error: err.message || "Failed to set consent" });
  }
};
