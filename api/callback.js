// Public callback request endpoint.
// Customers submit name + phone (optional time/message) from the storefront widget.
// We create a Shopify draft order tagged "callback-request" so the team sees it
// in Orders → Drafts and can action it immediately.

const { shopifyFetch, corsHeaders, rateLimit, sanitizeInput } = require("../lib/shopify");

module.exports = async function handler(req, res) {
  corsHeaders(res, req);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (rateLimit(req, res)) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const name = sanitizeInput(req.body.name, 100);
    const phone = sanitizeInput(req.body.phone, 30);
    const email = sanitizeInput(req.body.email || "", 320);
    const bestTime = sanitizeInput(req.body.best_time || "", 60);
    const message = sanitizeInput(req.body.message || "", 1000);
    const source = sanitizeInput(req.body.source || "storefront-widget", 80);

    if (!name || !phone) {
      return res.status(400).json({ error: "Name and phone are required." });
    }

    // Basic phone validation — allow + digits spaces dashes parentheses
    if (!/^[+\d\s\-()]{6,}$/.test(phone)) {
      return res.status(400).json({ error: "Invalid phone number." });
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Invalid email address." });
    }

    const note = [
      "[Callback Request from Storefront Widget]",
      "",
      `Name: ${name}`,
      `Phone: ${phone}`,
      email ? `Email: ${email}` : null,
      bestTime ? `Best time to call: ${bestTime}` : null,
      `Source: ${source}`,
      "",
      message ? `Message:\n${message}` : "(no additional message)",
    ]
      .filter(Boolean)
      .join("\n");

    const draftBody = {
      draft_order: {
        line_items: [
          {
            title: `Callback Request: ${name}`,
            quantity: 1,
            price: "0.00",
          },
        ],
        note,
        tags: "callback-request, storefront-widget",
      },
    };

    if (email) draftBody.draft_order.email = email;

    const result = await shopifyFetch("draft_orders.json", {
      method: "POST",
      body: JSON.stringify(draftBody),
    });

    if (result.draft_order) {
      console.log("Callback draft order created:", result.draft_order.id);
      return res.status(200).json({
        ok: true,
        message: "Thanks! We'll call you back shortly.",
      });
    }

    return res.status(500).json({ error: "Could not log callback request." });
  } catch (err) {
    console.error("Callback error:", err);
    return res.status(500).json({ error: "Failed to submit callback request." });
  }
};
