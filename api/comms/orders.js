/**
 * GET /api/comms/orders — recent Shopify orders for the dashboard Orders page.
 * Query: q (free-text Shopify order search), limit, cursor.
 *
 * Thin wrapper over shopify-ops `searchOrders`, which already sorts newest-first
 * and defaults to `status:any` when given no filters.
 */
const { requireDashboardAuth } = require("../../lib/dashboard-auth");
const { searchOrders } = require("../../lib/shopify-ops");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const session = requireDashboardAuth(req, res);
  if (!session) return;

  try {
    const result = await searchOrders({
      query: req.query.q,
      limit: req.query.limit || 25,
      after: req.query.cursor,
    });
    return res.status(200).json({ items: result.orders, page_info: result.page_info });
  } catch (err) {
    // Deliberately not forwarding err.statusCode: an upstream Shopify 401 (bad admin
    // token) would look to the browser like the dashboard session expired. The real
    // cause is logged here instead. Matches api/comms/contacts.js.
    console.error("[comms/orders]", err.message);
    return res.status(500).json({ error: "Failed to list orders" });
  }
};
