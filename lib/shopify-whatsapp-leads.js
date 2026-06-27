const { cleanEnv, shopifyFetch } = require("./shopify");

const WHATSAPP_TAGS = ["AI Agent", "ai-lead", "WhatsApp", "WhatsApp Lead"];
const METAFIELD_NAMESPACE = "paintaccess";
const METAFIELD_KEY = "whatsapp_phone";

function parseName(fullName) {
  const clean = String(fullName || "").trim();
  if (!clean) return { firstName: "WhatsApp", lastName: "Lead" };

  const parts = clean.split(/\s+/);
  return {
    firstName: parts[0] || clean,
    lastName: parts.slice(1).join(" ") || "",
  };
}

function normalizeTags(tags) {
  const existing = Array.isArray(tags)
    ? tags
    : String(tags || "")
        .split(",")
        .map((tag) => tag.trim());

  return [...new Set([...existing, ...WHATSAPP_TAGS].filter(Boolean))];
}

function phoneSearchQuery(phone) {
  return encodeURIComponent(`phone:${phone}`);
}

function isShopifyConfigured() {
  return !!(cleanEnv("SHOPIFY_STORE") && cleanEnv("SHOPIFY_ACCESS_TOKEN"));
}

async function setWhatsAppPhoneMetafield(customerId, phone) {
  try {
    const existing = await shopifyFetch(
      `customers/${customerId}/metafields.json?namespace=${encodeURIComponent(
        METAFIELD_NAMESPACE
      )}&key=${encodeURIComponent(METAFIELD_KEY)}`
    );
    const metafield = existing.metafields?.[0];
    const payload = {
      metafield: {
        namespace: METAFIELD_NAMESPACE,
        key: METAFIELD_KEY,
        type: "single_line_text_field",
        value: phone,
      },
    };

    if (metafield?.id) {
      await shopifyFetch(`metafields/${metafield.id}.json`, {
        method: "PUT",
        body: JSON.stringify({ metafield: { id: metafield.id, value: phone } }),
      });
      return;
    }

    await shopifyFetch(`customers/${customerId}/metafields.json`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.warn("[WhatsApp Lead] Metafield sync skipped:", err.message);
  }
}

async function upsertWhatsAppLead({ phone, profileName = "", message = "", provider = "" }) {
  if (!phone) return { action: "skipped", reason: "missing_phone" };
  if (!isShopifyConfigured()) return { action: "skipped", reason: "shopify_not_configured" };

  const note = [
    "WhatsApp conversation via Paint Access AI",
    provider ? `Provider: ${provider}` : null,
    message ? `First message: ${String(message).slice(0, 300)}` : null,
  ]
    .filter(Boolean)
    .join(" | ");

  const search = await shopifyFetch(
    `customers/search.json?query=${phoneSearchQuery(phone)}&limit=1`
  );
  const existing = search.customers?.[0];

  if (existing) {
    const tags = normalizeTags(existing.tags).join(",");
    await shopifyFetch(`customers/${existing.id}.json`, {
      method: "PUT",
      body: JSON.stringify({
        customer: {
          id: existing.id,
          tags,
          note: existing.note ? `${existing.note}\n${note}`.slice(0, 5000) : note,
        },
      }),
    });
    await setWhatsAppPhoneMetafield(existing.id, phone);
    console.log("[WhatsApp Lead] Existing customer tagged:", existing.id);
    return { action: "updated", customer_id: existing.id };
  }

  const { firstName, lastName } = parseName(profileName);
  const created = await shopifyFetch("customers.json", {
    method: "POST",
    body: JSON.stringify({
      customer: {
        first_name: firstName,
        last_name: lastName,
        phone,
        tags: WHATSAPP_TAGS.join(","),
        note,
        accepts_marketing: false,
      },
    }),
  });

  const customerId = created.customer?.id;
  if (customerId) await setWhatsAppPhoneMetafield(customerId, phone);

  console.log("[WhatsApp Lead] Customer created:", customerId);
  return { action: "created", customer_id: customerId };
}

module.exports = {
  upsertWhatsAppLead,
};
