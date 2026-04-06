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
      const draftId = draftOrder.draft_order.id;
      console.log("Draft order created:", draftId);

      // Actually send the invoice email via Shopify
      try {
        const invoiceResult = await shopifyFetch(
          `draft_orders/${draftId}/send_invoice.json`,
          {
            method: "POST",
            body: JSON.stringify({
              draft_order_invoice: {
                to: to,
                subject: subject,
                custom_message: message,
              },
            }),
          }
        );
        console.log("Invoice sent to:", to);
        return res.status(200).json({
          sent: true,
          message: `Email sent to ${to} successfully.`,
          draft_order_id: draftId,
        });
      } catch (invoiceErr) {
        console.error("Failed to send invoice:", invoiceErr);
        // Draft was created but email failed — still report partial success
        return res.status(200).json({
          sent: false,
          message: `Request logged (draft #${draftId}) but email delivery failed. The team will follow up manually.`,
          draft_order_id: draftId,
        });
      }
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
