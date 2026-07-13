/**
 * GET /api/comms/stats — folder + channel counts for the inbox badges.
 */
const { requireDashboardAuth } = require("../../lib/dashboard-auth");
const queries = require("../../lib/comms/queries");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const session = requireDashboardAuth(req, res);
  if (!session) return;

  try {
    const counts = await queries.getInboxCounts(session.sub);
    return res.status(200).json(counts);
  } catch (err) {
    console.error("[comms/stats]", err.message);
    return res.status(500).json({ error: "Failed to load stats" });
  }
};
