const { shopifyFetch, verifyAuth, corsHeaders } = require("../../lib/shopify");

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  if (!verifyAuth(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { to, subject, message, type } = req.body;

    if (!to || !subject || !message) {
      return res.status(400).json({
        error: "Missing required fields: to, subject, message",
      });
    }

    // Basic email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return res.status(400).json({ error: "Invalid email address" });
    }

    // Create a Draft Order in Shopify with a note containing the message.
    // This uses Shopify's built-in notification system — no external email service needed.
    // The Paint Access team sees these in Orders → Drafts, and can action them.
    const draftOrder = await shopifyFetch("draft_orders.json", {
      method: "POST",
      body: JSON.stringify({
        draft_order: {
          line_items: [
            {
              title: `AI Support Request: ${subject}`,
              quantity: 1,
              price: "0.00",
            },
          ],
          note: `[AI Assistant Email Request]\n\nTo: ${to}\nSubject: ${subject}\nType: ${type || "general"}\n\n${message}`,
          email: to,
          tags: "ai-assistant, email-request",
        },
      }),
    });

    if (draftOrder.draft_order) {
      console.log("Draft order created:", draftOrder.draft_order.id);
      return res.status(200).json({
        sent: true,
        message: `Your request has been logged and the Paint Access team will follow up via email to ${to}.`,
        draft_order_id: draftOrder.draft_order.id,
      });
    }

    return res.status(200).json({
      sent: false,
      message: "The request has been logged. The Paint Access team will be in touch.",
    });
  } catch (err) {
    console.error("Email send error:", err);
    return res.status(500).json({ error: "Failed to process email request." });
  }
};
