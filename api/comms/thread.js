/**
 * GET /api/comms/thread?id=<threadId> — one thread with its contact and full
 * message history (chronological). Marks the thread read.
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

  const id = String(req.query.id || "").trim();
  if (!id) return res.status(400).json({ error: "Missing thread id" });

  try {
    const data = await queries.getThread(id);
    if (!data) return res.status(404).json({ error: "Thread not found" });
    await queries.markRead(id);
    return res.status(200).json(data);
  } catch (err) {
    console.error("[comms/thread]", err.message);
    return res.status(500).json({ error: "Failed to load thread" });
  }
};
