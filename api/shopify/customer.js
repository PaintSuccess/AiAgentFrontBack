const {
  shopifyFetch,
  verifyAuth,
  corsHeaders,
  sanitizeInput,
  rateLimit,
} = require("../../lib/shopify");

// NOTE: Requires Shopify access token scope: write_customers
// If you see 403 errors, add write_customers to the custom app permissions
// in Shopify Admin → Settings → Apps and sales channels → Develop apps.

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{1,63}$/;

// Parse "John Smith" → { firstName: "John", lastName: "Smith" }
function parseName(fullName) {
  const parts = fullName.trim().split(/\s+/);
  return {
    firstName: parts[0] || fullName,
    lastName: parts.slice(1).join(" ") || "",
  };
}

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  if (!verifyAuth(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (rateLimit(req, res)) return;

  const { name, email, phone, tags, note } = req.body || {};

  // ── Validate ────────────────────────────────────────────────────────────
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: "name is required" });
  }
  if (!email || !String(email).trim()) {
    return res.status(400).json({ error: "email is required" });
  }

  const cleanName  = sanitizeInput(name, 100);
  const cleanEmail = sanitizeInput(email, 200).toLowerCase();
  const cleanPhone = phone
    ? String(phone).replace(/[^\d+\-() ]/g, "").trim().slice(0, 30)
    : null;
  const cleanNote  = note ? sanitizeInput(note, 500) : "Captured via AI widget";

  if (!EMAIL_RE.test(cleanEmail)) {
    return res.status(400).json({ error: "Invalid email address" });
  }

  // Tags: accept array or comma string from caller; always include base tags.
  const extraTags = Array.isArray(tags)
    ? tags.map((t) => String(t).trim())
    : typeof tags === "string"
      ? tags.split(",").map((t) => t.trim())
      : [];
  const baseTags = ["ai-lead", "ai-widget"];
  const tagSet = [...new Set([...baseTags, ...extraTags])].filter(Boolean);

  const { firstName, lastName } = parseName(cleanName);

  // ── Shopify upsert ───────────────────────────────────────────────────────
  try {
    // Search for an existing customer by email
    const searchData = await shopifyFetch(
      `customers/search.json?query=email:${encodeURIComponent(cleanEmail)}&limit=1`
    );
    const existing = searchData.customers?.[0];

    if (existing) {
      // Merge tags with whatever they already have
      const existingTags = existing.tags
        ? existing.tags.split(",").map((t) => t.trim()).filter(Boolean)
        : [];
      const mergedTags = [...new Set([...existingTags, ...tagSet])].join(",");

      const updated = await shopifyFetch(`customers/${existing.id}.json`, {
        method: "PUT",
        body: JSON.stringify({
          customer: {
            id: existing.id,
            tags: mergedTags,
            note: cleanNote,
            // Only set phone if not already on file
            ...(cleanPhone && !existing.phone ? { phone: cleanPhone } : {}),
          },
        }),
      });

      console.log("[customer] updated:", updated.customer.id);
      return res.status(200).json({
        action: "updated",
        customer_id: updated.customer.id,
        email: cleanEmail,
      });
    }

    // Create new customer
    const created = await shopifyFetch("customers.json", {
      method: "POST",
      body: JSON.stringify({
        customer: {
          first_name: firstName,
          last_name: lastName,
          email: cleanEmail,
          ...(cleanPhone ? { phone: cleanPhone } : {}),
          tags: tagSet.join(","),
          note: cleanNote,
          accepts_marketing: false, // explicit opt-in required (GDPR/SPAM Act 2003)
          verified_email: false,
        },
      }),
    });

    console.log("[customer] created:", created.customer.id);
    return res.status(201).json({
      action: "created",
      customer_id: created.customer.id,
      email: cleanEmail,
    });
  } catch (err) {
    console.error("[customer upsert]", err.message);
    // 422 = Shopify validation error (e.g. email taken by a different account
    // variant). Treat as non-fatal so callers don't fail completely.
    if (err.statusCode === 422) {
      return res.status(200).json({
        action: "skipped",
        reason: "shopify_validation_error",
        detail: err.upstream?.slice(0, 200),
      });
    }
    return res.status(500).json({ error: "Failed to upsert customer" });
  }
};
