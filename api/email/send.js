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
    // retries it — without this the same quote email + a second Shopify draft order could
    // be created. A retry with the same to/subject/message inside the window is reported
    // as sent without re-creating anything. Claim BEFORE the draft (the first side
    // effect); the claim is kept ONLY when the invoice (the actual customer-facing email)
    // is CONFIRMED to have sent — every other outcome below releases it, because a
    // duplicate internal draft note is low-harm but silently blocking a retry that could
    // still deliver the customer's quote is not. Fail-open (a DB hiccup never blocks a
    // real email).
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
        // The draft note is an internal record only the team sees — a duplicate one is
        // low-harm. The invoice is the actual customer-facing email, and it did NOT go
        // out here, so keeping the claim would silently block a retry from ever
        // delivering the customer's quote (Codex review finding, 2026-07-22: the first
        // version always kept the claim in this branch). Release when shopifyFetch
        // confirms Shopify itself rejected the send (err.statusCode set); on a raw
        // network exception (no statusCode) we can't rule out the invoice having already
        // gone out, so keep the claim rather than risk a duplicate customer email.
        if (invoiceErr.statusCode) await releaseSend("email", dedupParts).catch(() => {});
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
    // shopifyFetch sets err.statusCode only when Shopify actually returned an HTTP
    // response (a confirmed rejection — no draft was created). A raw network exception
    // (timeout, connection reset) has no statusCode: Shopify may have already created the
    // draft before the connection dropped, so we do NOT release in that ambiguous case —
    // a retry within the TTL stays blocked rather than risking an actual duplicate draft
    // order (Codex review finding, 2026-07-22: the first version released on ANY error
    // here, including this ambiguous case).
    if (dedupParts && err.statusCode) await releaseSend("email", dedupParts).catch(() => {});
    console.error("Email send error:", err);
    return res.status(500).json({ error: "Failed to process email request." });
  }
};
