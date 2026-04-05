const { shopifyFetch, verifyAuth, corsHeaders } = require("../../lib/shopify");

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  if (!verifyAuth(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const { order_number, email } = req.method === "POST" ? req.body : req.query;

    if (!order_number && !email) {
      return res.status(400).json({
        error: "Please provide an order_number or email to look up the order.",
      });
    }

    let orders;

    if (order_number) {
      // Search by order number (e.g., #1001 or 1001)
      const cleanNumber = String(order_number).replace(/^#/, "");
      const data = await shopifyFetch(
        `orders.json?name=%23${cleanNumber}&status=any&limit=1`
      );
      orders = data.orders || [];
    } else if (email) {
      // Search by email — return most recent orders
      const data = await shopifyFetch(
        `orders.json?email=${encodeURIComponent(email)}&status=any&limit=5`
      );
      orders = data.orders || [];
    }

    if (!orders || orders.length === 0) {
      return res.status(200).json({
        found: false,
        message: order_number
          ? `No order found with number #${order_number}.`
          : `No orders found for email ${email}.`,
      });
    }

    // Return simplified order data
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
          variant_title: item.variant_title,
          quantity: item.quantity,
          price: item.price,
        })),
        fulfillments,
        shipping_address: order.shipping_address
          ? {
              city: order.shipping_address.city,
              province: order.shipping_address.province,
              country: order.shipping_address.country,
            }
          : null,
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
