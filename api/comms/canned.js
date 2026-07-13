/**
 * Quick replies / canned responses.
 *   GET    /api/comms/canned            → list
 *   POST   /api/comms/canned            → create { title, body, channel? }
 *   DELETE /api/comms/canned?id=...      → delete
 */
const { requireDashboardAuth } = require("../../lib/dashboard-auth");
const { listCanned, createCanned, deleteCanned } = require("../../lib/comms/canned");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  const session = requireDashboardAuth(req, res);
  if (!session) return;

  try {
    if (req.method === "GET") {
      return res.status(200).json(await listCanned());
    }
    if (req.method === "POST") {
      const { title, body, channel } = req.body || {};
      if (!title || !body) return res.status(400).json({ error: "title and body are required" });
      const created = await createCanned({ title, body, channel });
      return res.status(200).json({ ok: true, item: created });
    }
    if (req.method === "DELETE") {
      const id = String(req.query.id || "").trim();
      if (!id) return res.status(400).json({ error: "Missing id" });
      await deleteCanned(id);
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[comms/canned]", err.message);
    return res.status(500).json({ error: "Failed" });
  }
};
