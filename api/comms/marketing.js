/**
 * GET /api/comms/marketing — audience, ad attribution, reach and marketing templates.
 * Read-only: this page reports, it never sends.
 */
const { requireDashboardAuth } = require("../../lib/dashboard-auth");
const marketing = require("../../lib/comms/marketing");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const session = requireDashboardAuth(req, res);
  if (!session) return;

  try {
    const overview = await marketing.getMarketingOverview();
    return res.status(200).json(overview);
  } catch (err) {
    console.error("[comms/marketing]", err.message);
    return res.status(500).json({ error: "Failed to load marketing overview" });
  }
};
