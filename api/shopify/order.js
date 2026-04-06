const { shopifyFetch, verifyAuth, corsHeaders } = require("../../lib/shopify");

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  if (!verifyAuth(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const { order_number, email, customer_email } =
      req.method === "POST" ? req.body : req.query;

    // customer_email = the verified email from the logged-in customer's session
    // (passed via dynamic variables from Shopify Liquid — cannot be spoofed by the user)
    // email = the email the user provides in chat (unverified, user-supplied)

    if (!order_number && !email) {
      return res.status(400).json({
        error: "Please provide an order_number or email to look up the order.",
      });
    }

    let orders;

    if (order_number) {
      const cleanNumber = String(order_number).replace(/^#/, "");
      const data = await shopifyFetch(
        `orders.json?name=%23${cleanNumber}&status=any&limit=1`
      );
      orders = data.orders || [];

      // SECURITY: If customer is logged in, only show orders belonging to them.
      // If guest, require matching email as a second verification factor.
      if (orders.length > 0) {
        const verifyEmail = customer_email || email;
        if (!verifyEmail) {
          return res.status(200).json({
            found: false,
            message:
              "For security, please provide your email address to verify this order belongs to you.",
          });
        }
        orders = orders.filter(
          (o) => o.email && o.email.toLowerCase() === verifyEmail.toLowerCase()
        );
        if (orders.length === 0) {
          return res.status(200).json({
            found: false,
            message: `Order #${order_number} was not found for this email address. Please check your order number and the email you used when placing the order.`,
          });
        }
      }
    } else if (email) {
      // SECURITY: Logged-in customers can only look up their own orders.
      // Guests can look up by email they provide (standard storefront behavior).
      const lookupEmail = customer_email || email;
      // If logged in and the requested email doesn't match their account, block it.
      if (
        customer_email &&
        email &&
        customer_email.toLowerCase() !== email.toLowerCase()
      ) {
        return res.status(200).json({
          found: false,
          message:
            "For privacy, you can only look up orders associated with your own account email.",
        });
      }
      const data = await shopifyFetch(
        `orders.json?email=${encodeURIComponent(lookupEmail)}&status=any&limit=5`
      );
      orders = data.orders || [];
    }

    if (!orders || orders.length === 0) {
      return res.status(200).json({
        found: false,
        message: order_number
          ? `No order found with number #${order_number}.`
          : `No orders found for that email address.`,
      });
    }

    // Return simplified order data — no full addresses, no other customers' info
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
        shipping_city: order.shipping_address
          ? order.shipping_address.city
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
