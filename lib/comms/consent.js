/**
 * Per-channel marketing consent. Email + SMS mirror Shopify (source of truth);
 * WhatsApp + Calls are stored locally. Transactional messages are NOT gated —
 * only marketing sends check this.
 */
const { getSupabase } = require("../supabase");
const { normalizeE164 } = require("../whatsapp");
const { ensureShopifyCustomerId, updateShopifyConsent } = require("./shopify-sync");

const COL = { email: "email_marketing", sms: "sms_marketing", whatsapp: "whatsapp_marketing", calls: "calls_consent" };
const VALID = ["subscribed", "not_subscribed", "unsubscribed", "unknown"];
const norm = (s) => (VALID.includes(s) ? s : "unknown");

/** True only if the contact is opted in to marketing on this channel. */
function canSendMarketing(contact, channel) {
  if (!contact) return false;
  if (channel === "calls") return contact.calls_consent === "subscribed" && !contact.do_not_call;
  const col = COL[channel];
  return col ? contact[col] === "subscribed" : false;
}

function mapShopifyEmail(customer) {
  const c = customer?.email_marketing_consent;
  if (c?.state) return norm(c.state);
  return customer?.accepts_marketing ? "subscribed" : "unknown";
}
function mapShopifySms(customer) {
  return norm(customer?.sms_marketing_consent?.state);
}

/** Mirror a Shopify customer's email/sms consent into the local contact. */
async function syncFromShopify(contactId, customer) {
  const sb = getSupabase();
  if (!sb || !contactId || !customer) return null;
  const patch = {
    email_marketing: mapShopifyEmail(customer),
    sms_marketing: mapShopifySms(customer),
    consent_source: "shopify",
    consent_updated_at: new Date().toISOString(),
  };
  const { data } = await sb.from("contacts").update(patch).eq("id", contactId).select("*").maybeSingle();
  return data;
}

/**
 * Set a channel's consent.
 *
 * Email/SMS: Shopify is the source of truth. We write there FIRST and only
 * mirror the change into our local record once Shopify accepts it — so we
 * never show a status locally that Shopify rejected (which would otherwise
 * just silently bounce back to the real value on the next contact-panel
 * load). On failure we throw with Shopify's actual reason so the caller can
 * show it (e.g. "this contact has no email on file").
 *
 * WhatsApp/Calls: local-only, no Shopify round-trip.
 */
async function setConsent({ contactId, channel, status }) {
  const sb = getSupabase();
  if (!sb) return { ok: false };
  const col = COL[channel];
  if (!col || !VALID.includes(status)) {
    const e = new Error("Invalid channel or status");
    e.statusCode = 400;
    throw e;
  }
  const { data: contact } = await sb.from("contacts").select("*").eq("id", contactId).maybeSingle();
  if (!contact) {
    const e = new Error("Contact not found");
    e.statusCode = 404;
    throw e;
  }

  if (channel === "email" || channel === "sms") {
    const custId = await ensureShopifyCustomerId(contact);
    if (!custId) {
      const e = new Error(`This contact isn't linked to a Shopify customer, so ${channel} consent can't be synced.`);
      e.statusCode = 400;
      throw e;
    }
    try {
      await updateShopifyConsent(custId, { channel, status });
    } catch (err) {
      const reason = /email address is required/i.test(err.message)
        ? "This contact has no email address on file in Shopify."
        : err.message || "Shopify rejected this change.";
      const e = new Error(reason);
      e.statusCode = 422;
      throw e;
    }
    await sb
      .from("contacts")
      .update({ [col]: status, consent_source: "shopify", consent_updated_at: new Date().toISOString() })
      .eq("id", contactId);
    return { ok: true, shopifySynced: true };
  }

  const patch = { [col]: status, consent_source: "manual", consent_updated_at: new Date().toISOString() };
  if (channel === "calls") patch.do_not_call = status === "unsubscribed";
  await sb.from("contacts").update(patch).eq("id", contactId);
  return { ok: true, shopifySynced: false };
}

/** STOP / START keyword opt-out/in on inbound SMS or WhatsApp (fail-safe). */
const STOP = ["stop", "unsubscribe", "stopall", "cancel", "end", "quit", "optout"];
const START = ["start", "yes", "unstop", "subscribe", "optin"];
async function applyKeywordConsent(phone, channel, body) {
  try {
    const word = String(body || "").trim().toLowerCase().replace(/[^a-z]/g, "");
    const isStop = STOP.includes(word);
    const isStart = START.includes(word);
    if (!isStop && !isStart) return;
    const sb = getSupabase();
    if (!sb) return;
    const p = normalizeE164(phone);
    if (!p) return;
    const { data: contact } = await sb.from("contacts").select("id").eq("phone", p).maybeSingle();
    if (!contact) return;
    await setConsent({ contactId: contact.id, channel, status: isStop ? "unsubscribed" : "subscribed" });
    console.log(`[consent] ${channel} ${isStop ? "opt-out" : "opt-in"} via keyword from ${p}`);
  } catch (err) {
    console.error("[consent] keyword:", err.message);
  }
}

module.exports = { canSendMarketing, syncFromShopify, setConsent, applyKeywordConsent, mapShopifyEmail, mapShopifySms };
