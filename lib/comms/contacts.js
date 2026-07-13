/**
 * Contact directory + contact edits (with Shopify customer write-back).
 */
const { getSupabase } = require("../supabase");
const { ensureShopifyCustomerId, updateShopifyCustomer } = require("./shopify-sync");

const UNIQUE_VIOLATION = "23505";

/**
 * Update a contact locally and mirror name/email/tags/notes to its Shopify
 * customer when one is linked/resolvable. Returns which parts synced.
 */
async function updateContact(contactId, { name, email, tags, notes } = {}) {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: "not configured" };

  const { data: contact } = await sb.from("contacts").select("*").eq("id", contactId).maybeSingle();
  if (!contact) {
    const err = new Error("Contact not found");
    err.statusCode = 404;
    throw err;
  }

  const patch = {};
  if (name !== undefined) patch.name = name || null;
  if (email !== undefined) patch.email = email ? String(email).trim().toLowerCase() : null;
  if (tags !== undefined) patch.tags = tags;
  if (notes !== undefined) patch.notes = notes;

  let updated = contact;
  if (Object.keys(patch).length) {
    const { data, error } = await sb.from("contacts").update(patch).eq("id", contactId).select("*").maybeSingle();
    if (error) {
      if (error.code === UNIQUE_VIOLATION) {
        const e = new Error("Another contact already uses that phone or email.");
        e.statusCode = 409;
        throw e;
      }
      throw error;
    }
    updated = data || contact;
  }

  // Write-back to Shopify customer if we can resolve one.
  let shopifySynced = false;
  let shopifyError = null;
  const customerId = await ensureShopifyCustomerId(updated);
  if (customerId) {
    try {
      const fields = {};
      if (name !== undefined) {
        const parts = String(name || "").trim().split(/\s+/);
        fields.firstName = parts[0] || "";
        fields.lastName = parts.slice(1).join(" ");
      }
      if (email !== undefined) fields.email = updated.email || undefined;
      if (tags !== undefined) fields.tags = tags;
      if (notes !== undefined) fields.note = notes;
      await updateShopifyCustomer(customerId, fields);
      shopifySynced = true;
    } catch (err) {
      shopifyError = err.publicMessage || err.message;
      console.error("[contacts] Shopify sync failed:", shopifyError);
    }
  }

  return { ok: true, contact: updated, shopifySynced, shopifyError };
}

/** Contact directory list (with each contact's thread summary). */
async function listContacts({ q, limit = 100 } = {}) {
  const sb = getSupabase();
  if (!sb) return { items: [] };
  let query = sb
    .from("contacts")
    .select("*, threads(id, last_message_at, last_message_preview, last_channel, unread_count)")
    .order("updated_at", { ascending: false })
    .limit(Math.min(Number(limit) || 100, 300));
  if (q && String(q).trim()) {
    const like = `%${String(q).trim()}%`;
    query = query.or(`name.ilike.${like},email.ilike.${like},phone.ilike.${like}`);
  }
  const { data, error } = await query;
  if (error) throw error;
  return { items: data || [] };
}

module.exports = { updateContact, listContacts };
