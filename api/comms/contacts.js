/**
 * GET /api/comms/contacts — contact directory. Query: q, limit.
 */
const { requireDashboardAuth } = require("../../lib/dashboard-auth");
const { listContacts } = require("../../lib/comms/contacts");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const session = requireDashboardAuth(req, res);
  if (!session) return;

  try {
    const { items } = await listContacts({ q: req.query.q, limit: req.query.limit });
    return res.status(200).json({ items });
  } catch (err) {
    console.error("[comms/contacts]", err.message);
    return res.status(500).json({ error: "Failed to list contacts" });
  }
};
