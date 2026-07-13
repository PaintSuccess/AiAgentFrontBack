/**
 * GET /api/comms/contact?id=<threadId> — contact context for the inbox side
 * panel: the stored contact, conversation stats, and Shopify customer + recent
 * orders (looked up by phone). Loaded separately from the thread so the Shopify
 * lookup never slows the conversation view.
 */
const { requireDashboardAuth } = require("../../lib/dashboard-auth");
const queries = require("../../lib/comms/queries");
const { getCustomerContextByPhone } = require("../../lib/shopify-customer-context");

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

    const contact = data.thread.contact || {};
    const msgs = data.messages || [];
    const stats = {
      messages_count: msgs.length,
      inbound: msgs.filter((m) => m.direction === "inbound").length,
      outbound: msgs.filter((m) => m.direction === "outbound").length,
      first_contact: msgs[0]?.sent_at || null,
      last_seen: msgs[msgs.length - 1]?.sent_at || null,
      channels: [...new Set(msgs.map((m) => m.channel))],
    };

    let shopify = null;
    if (contact.phone) {
      try {
        const ctx = await getCustomerContextByPhone(contact.phone);
        if (ctx?.found) {
          shopify = {
            customer_id: ctx.customer_id,
            name: ctx.customer_name,
            email: ctx.customer_email,
            tags: String(ctx.customer_tags || "")
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
            orders: (ctx.recentOrders || []).map((o) => ({
              id: o.id,
              name: o.name,
              created_at: o.created_at,
              total_price: o.total_price,
              currency: o.currency || "AUD",
              financial_status: o.financial_status || null,
              fulfillment_status: o.fulfillment_status || "unfulfilled",
              items: (o.line_items || []).slice(0, 3).map((li) => `${li.title} ×${li.quantity}`),
            })),
          };
        }
      } catch (err) {
        console.error("[comms/contact] shopify lookup:", err.message);
      }
    }

    return res.status(200).json({ contact, stats, shopify });
  } catch (err) {
    console.error("[comms/contact]", err.message);
    return res.status(500).json({ error: "Failed to load contact" });
  }
};
