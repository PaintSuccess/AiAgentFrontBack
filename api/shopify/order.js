const { shopifyFetch, verifyAuth, corsHeaders, rateLimit, sanitizeInput } = require("../../lib/shopify");

module.exports = async function handler(req, res) {
  corsHeaders(res, req);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (rateLimit(req, res)) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!verifyAuth(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const params = req.body || {};
    const order_number = sanitizeInput(params.order_number, 20);
    const email = sanitizeInput(params.email, 320);

    // Public AI channels cannot prove Shopify storefront identity. Dynamic
    // variables are useful for personalization, but not for access control.
    // Require the caller to provide both order number and matching order email.
    if (!order_number || !email) {
      return res.status(200).json({
        found: false,
        message:
          "For security, please provide both your order number and the email used for that order.",
      });
    }

    const cleanNumber = String(order_number).replace(/^#/, "");
    const data = await shopifyFetch(
      `orders.json?name=%23${cleanNumber}&status=any&limit=1`
    );
    let orders = data.orders || [];

    orders = orders.filter(
      (o) => o.email && o.email.toLowerCase() === email.toLowerCase()
    );

    if (data.orders?.length && orders.length === 0) {
      return res.status(200).json({
        found: false,
        message: `Order #${cleanNumber} was not found for this email address. Please check your order number and the email you used when placing the order.`,
      });
    }

    if (!orders || orders.length === 0) {
      return res.status(200).json({
        found: false,
        message: `No order found with number #${cleanNumber}.`,
      });
    }

    // Return simplified order data. No full addresses, customer profile,
    // payment details, notes, tags, or unrelated customer fields.
    const results = orders.map((order) => {
      const fulfillments = (order.fulfillments || []).map((f) => ({
        status: f.status,
        tracking_number: f.tracking_number || null,
        tracking_url: f.tracking_url || null,
        tracking_company: f.tracking_company || null,
        created_at: f.created_at,
      }));

      return {
        order_number: order.name,
        created_at: order.created_at,
        financial_status: order.financial_status,
        fulfillment_status: order.fulfillment_status || "unfulfilled",
        total_price: order.total_price,
        currency: order.currency,
        line_items: (order.line_items || []).map((item) => ({
          title: item.title,
          quantity: item.quantity,
          price: item.price,
        })),
        fulfillments,
      };
    });

    return res.status(200).json({
      found: true,
      orders: results,
    });
  } catch (err) {
    console.error("Order lookup error:", err);
    return res.status(500).json({ error: "Failed to look up order." });
  }
};
