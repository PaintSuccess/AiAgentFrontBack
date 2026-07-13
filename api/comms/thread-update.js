/**
 * POST /api/comms/thread-update — set thread state.
 * Body: { threadId, status?, starred?, pinned?, labels?, snoozed_until?,
 *         assign? }  where assign = "me" | "none" | <userId>.
 */
const { requireDashboardAuth } = require("../../lib/dashboard-auth");
const queries = require("../../lib/comms/queries");

const STATUSES = ["open", "pending", "closed", "snoozed"];

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
  if (!threadId) return res.status(400).json({ error: "Missing threadId" });

  const fields = {};
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) return res.status(400).json({ error: "Invalid status" });
    fields.status = body.status;
  }
  if (body.starred !== undefined) fields.starred = !!body.starred;
  if (body.pinned !== undefined) fields.pinned = !!body.pinned;
  if (body.snoozed_until !== undefined) fields.snoozed_until = body.snoozed_until || null;
  if (Array.isArray(body.labels)) fields.labels = body.labels.map((l) => String(l).slice(0, 40)).slice(0, 20);
  if (body.assign !== undefined) {
    fields.assigned_to = body.assign === "me" ? session.sub || null : body.assign === "none" ? null : String(body.assign);
  }

  try {
    const thread = await queries.setThreadFields(threadId, fields);
    if (!thread) return res.status(404).json({ error: "Thread not found or no changes" });
    return res.status(200).json({ ok: true, thread, currentUser: session.sub || null });
  } catch (err) {
    console.error("[comms/thread-update]", err.message);
    return res.status(500).json({ error: "Failed to update thread" });
  }
};
