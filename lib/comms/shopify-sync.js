/**
 * Write-back sync from a comms contact to its Shopify customer record.
 * Tags, note, and identity edits made in the inbox update the real Shopify
 * customer so the two stay in sync.
 */
const { shopifyFetch } = require("../shopify");
const { getSupabase } = require("../supabase");
const { getCustomerContextByPhone } = require("../shopify-customer-context");

/** Return the contact's Shopify customer id, resolving + persisting it if needed. */
async function ensureShopifyCustomerId(contact) {
  if (!contact) return null;
  if (contact.shopify_customer_id) return contact.shopify_customer_id;
  if (!contact.phone) return null;
  try {
    const ctx = await getCustomerContextByPhone(contact.phone);
    if (ctx?.found && ctx.customer_id) {
      const sb = getSupabase();
      if (sb) await sb.from("contacts").update({ shopify_customer_id: ctx.customer_id }).eq("id", contact.id);
      return ctx.customer_id;
    }
  } catch (err) {
    console.error("[shopify-sync] resolve id:", err.message);
  }
  return null;
}

/** PUT selected fields onto a Shopify customer. Only provided keys are sent. */
async function updateShopifyCustomer(customerId, { firstName, lastName, email, tags, note } = {}) {
  const customer = { id: Number(customerId) };
  if (firstName !== undefined) customer.first_name = firstName;
  if (lastName !== undefined) customer.last_name = lastName;
  if (email !== undefined && email) customer.email = email;
  if (tags !== undefined) customer.tags = Array.isArray(tags) ? tags.join(", ") : String(tags || "");
  if (note !== undefined) customer.note = note || "";
  return shopifyFetch(`customers/${customerId}.json`, {
    method: "PUT",
    body: JSON.stringify({ customer }),
  });
}

/** Write email/sms marketing consent to a Shopify customer (source of truth). */
async function updateShopifyConsent(customerId, { channel, status }) {
  // Shopify only accepts 'subscribed' / 'unsubscribed' as settable states
  // ('not_subscribed' is the neutral default and can't be pushed via the API).
  if (status !== "subscribed" && status !== "unsubscribed") return null;
  // Backdate slightly — Shopify rejects a consent_updated_at in the future (clock skew).
  const consent = { state: status, opt_in_level: "single_opt_in", consent_updated_at: new Date(Date.now() - 60000).toISOString() };
  const customer = { id: Number(customerId) };
  if (channel === "email") customer.email_marketing_consent = consent;
  else if (channel === "sms") customer.sms_marketing_consent = { ...consent, consent_collected_from: "OTHER" };
  else return null;
  return shopifyFetch(`customers/${customerId}.json`, { method: "PUT", body: JSON.stringify({ customer }) });
}

module.exports = { ensureShopifyCustomerId, updateShopifyCustomer, updateShopifyConsent };
