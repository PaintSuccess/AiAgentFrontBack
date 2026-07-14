/**
 * GET /api/comms/wa-templates — the account's Meta-approved WhatsApp templates
 * for the composer picker (sid, name, category, body, variables).
 */
const { requireDashboardAuth } = require("../../lib/dashboard-auth");
const { listApprovedTemplates } = require("../../lib/comms/wa-templates");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const session = requireDashboardAuth(req, res);
  if (!session) return;

  try {
    const items = await listApprovedTemplates({ force: req.query.force === "1" });
    return res.status(200).json({ items });
  } catch (err) {
    console.error("[comms/wa-templates]", err.message);
    return res.status(200).json({ items: [], error: "Could not load templates" });
  }
};
