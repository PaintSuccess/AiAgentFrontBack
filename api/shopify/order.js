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

    const payload = {
      found: result.found,
      message: result.message,
      needs_verification: Boolean(result.needsVerification),
      orders: result.orders || [],
    };

    // On a successful single-order lookup, hand the widget everything it needs to
    // render an on-screen order card (mirrors search_products). Links live in the
    // payload/link fields, never in the spoken `message`.
    if (result.found && result.display_order_payload) {
      payload.order_link = result.order_link || null;
      payload.tracking_link = result.tracking_link || null;
      payload.display_order_in_chat_payload = result.display_order_payload;
      payload.next_action_required =
        "If this conversation is in the website widget or browser voice mode, your immediate next tool call MUST be display_order_in_chat using display_order_in_chat_payload, before you speak. Do NOT read the order or tracking URL aloud — give a one-line spoken summary and say the details are on their screen. If the channel is SMS or WhatsApp, do NOT call display_order_in_chat; instead end your text reply with the order link (order_link) and tracking link (tracking_link) when present.";
    }

    return res.status(200).json(payload);
  } catch (err) {
    console.error("Order lookup error:", err);
    return res.status(500).json({ error: "Failed to look up order." });
  }
};
