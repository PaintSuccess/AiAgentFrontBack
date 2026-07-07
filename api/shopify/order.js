const { verifyAuth, corsHeaders, rateLimit, sanitizeInput } = require("../../lib/shopify");
const { lookupCustomerOrder } = require("../../lib/customer-order-lookup");

module.exports = async function handler(req, res) {
  corsHeaders(res, req);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (await rateLimit(req, res)) return;

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
    const customer_id = sanitizeInput(params.customer_id, 80);
    const customer_email = sanitizeInput(params.customer_email, 320);
    const customer_phone = sanitizeInput(params.customer_phone, 40);

    const result = await lookupCustomerOrder({
      orderNumber: order_number,
      email,
      customerId: customer_id,
      customerEmail: customer_email || email,
      customerPhone: customer_phone,
    });

    return res.status(200).json({
      found: result.found,
      message: result.message,
      needs_verification: Boolean(result.needsVerification),
      orders: result.orders || [],
    });
  } catch (err) {
    console.error("Order lookup error:", err);
    return res.status(500).json({ error: "Failed to look up order." });
  }
};
