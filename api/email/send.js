const { shopifyFetch, verifyAuth, corsHeaders, rateLimit, sanitizeInput } = require("../../lib/shopify");
const { claimSend, releaseSend } = require("../../lib/tool-dedup");

module.exports = async function handler(req, res) {
  corsHeaders(res, req);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (await rateLimit(req, res)) return;

  if (!verifyAuth(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  let dedupParts = null;
  try {
    const to = sanitizeInput(req.body.to, 320);
    const subject = sanitizeInput(req.body.subject, 200);
    const message = sanitizeInput(req.body.message, 2000);
    const type = sanitizeInput(req.body.type || "general", 50);

    if (!to || !subject || !message) {
      return res.status(400).json({
        error: "Missing required fields: to, subject, message",
      });
    }

    // Basic email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return res.status(400).json({ error: "Invalid email address" });
    }

    // Idempotency: an "abandoned" tool call still runs server-side and the agent often
    // retries it — without this the same quote email + a second Shopify draft order would
    // be created. A retry with the same to/subject/message inside the window is reported
    // as sent without re-creating anything. Claim BEFORE the draft (the first side effect);
    // release only on a TOTAL failure below (a partial success keeps the claim, so a retry
    // cannot create a duplicate draft). Fail-open (a DB hiccup never blocks a real email).
    dedupParts = [to, subject, message];
    if ((await claimSend("email", dedupParts)) === "duplicate") {
      return res.status(200).json({ sent: true, deduped: true, message: `Email to ${to} already sent.` });
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
    // Total failure — no draft order was created, so release the claim to let a genuine
    // retry try again rather than falsely reporting "already sent".
    if (dedupParts) await releaseSend("email", dedupParts).catch(() => {});
    console.error("Email send error:", err);
    return res.status(500).json({ error: "Failed to process email request." });
  }
};
