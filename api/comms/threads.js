/**
 * GET /api/comms/threads — list inbox threads (most-recent first) from the
 * comms spine. Query: limit, status, channel, q (search).
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
    const { items } = await queries.listThreads({
      limit: req.query.limit,
      status: req.query.status,
      channel: req.query.channel,
      q: req.query.q,
    });
    return res.status(200).json({ items });
  } catch (err) {
    console.error("[comms/threads]", err.message);
    return res.status(500).json({ error: "Failed to list threads" });
  }
};
