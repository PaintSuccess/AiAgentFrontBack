/**
 * GET /api/dashboard/emails
 * Fetches sent emails from Shopify draft orders tagged "ai-assistant".
 *
 * Query params:
 *   limit  — 1-100, default 25
 *   status — "open", "invoice_sent", "completed" (default: all)
 *   since  — ISO date string
 */
const { shopifyFetch } = require("../../lib/shopify");
const { requireDashboardAuth } = require("../../lib/dashboard-auth");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = requireDashboardAuth(req, res);
  if (!session) return;

  try {
    const limit = Math.min(parseInt(req.query.limit) || 25, 100);
    const params = new URLSearchParams();
    params.set("limit", limit);
    params.set("fields", "id,name,email,note,status,created_at,updated_at,tags");

    if (req.query.status) params.set("status", req.query.status);
    if (req.query.since) params.set("created_at_min", req.query.since);

    const data = await shopifyFetch(`draft_orders.json?${params}`);
    const drafts = data.draft_orders || [];

    // Filter to only AI-assistant emails
    const aiDrafts = drafts.filter(
      (d) => d.tags && d.tags.includes("ai-assistant")
    );

    const items = aiDrafts.map((d) => {
      // Parse the note to extract email details
      const note = d.note || "";
      const toMatch = note.match(/To:\s*(.+)/);
      const subjectMatch = note.match(/Subject:\s*(.+)/);
      const typeMatch = note.match(/Type:\s*(.+)/);

      return {
        id: d.id,
        type: "email",
        to: toMatch ? toMatch[1].trim() : d.email,
        subject: subjectMatch ? subjectMatch[1].trim() : d.name,
        email_type: typeMatch ? typeMatch[1].trim() : "general",
        status: d.status,
        started_at: d.created_at,
        draft_name: d.name,
      };
    });

    return res.status(200).json({ items });
  } catch (err) {
    console.error("Dashboard emails error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
