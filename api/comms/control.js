/**
 * POST /api/comms/control — set a thread's AI-control mode.
 * Body: { threadId, control_mode: "ai" | "human" | "paused" }
 *
 * "human" = a person has taken over; inbound webhooks stop auto-replying.
 * "ai"    = hand back to the AI.
 */
const { requireDashboardAuth } = require("../../lib/dashboard-auth");
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
  const threadId = String(body.threadId || "").trim();
  const mode = String(body.control_mode || "").toLowerCase();

  if (!threadId) return res.status(400).json({ error: "Missing threadId" });

  try {
    const thread = await queries.setControl(threadId, mode);
    if (!thread) return res.status(404).json({ error: "Thread not found" });
    return res.status(200).json({ ok: true, thread });
  } catch (err) {
    console.error("[comms/control]", err.message);
    return res.status(err.statusCode || 500).json({ error: err.message || "Failed to set control" });
  }
};
