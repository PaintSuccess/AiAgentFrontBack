/**
 * Meta Conversions API — report WhatsApp funnel outcomes back to Meta so the ad algorithm
 * optimises on real leads and orders, not just "conversation started".
 *
 * The link is `ctwa_clid`, captured on the ad-click message and stored at
 * `contacts.first_referral.ctwa_clid` (see the referral-capture work). This fires it back.
 *
 * Endpoint + payload per Meta's business-messaging CAPI onboarding guide (verified 2026-07-16):
 *   POST graph.facebook.com/v{ver}/{DATASET_ID}/events?access_token=...
 *   { data:[{ event_name, event_time(unix s), action_source:"business_messaging",
 *             messaging_channel:"whatsapp", user_data:{ whatsapp_business_account_id, ctwa_clid },
 *             custom_data:{ currency, value } }], partner_agent }
 *
 * CONFIG (the one blocker): needs META_CAPI_ACCESS_TOKEN — a System User / Business Integration
 * token with `whatsapp_business_manage_events`. Until that's set this whole module NO-OPS
 * (logs and returns {skipped}), so it is safe to ship and wire now; it starts working the
 * moment the token lands. DATASET_ID defaults to the live pixel we confirmed.
 */
const { cleanEnv } = require("../shopify");

const DEFAULT_DATASET_ID = "334352823575129"; // "PaintAccess's Pixel", confirmed live 2026-07-16
const DEFAULT_VERSION = "v23.0";
const PARTNER_AGENT = "paintaccess-aiagent";

function config() {
  return {
    token: cleanEnv("META_CAPI_ACCESS_TOKEN"),
    datasetId: cleanEnv("META_CAPI_DATASET_ID") || DEFAULT_DATASET_ID,
    wabaId: cleanEnv("META_WABA_ID") || cleanEnv("META_WHATSAPP_BUSINESS_ACCOUNT_ID") || null,
    version: cleanEnv("META_GRAPH_VERSION") || DEFAULT_VERSION,
  };
}

function isConfigured() {
  const c = config();
  return !!(c.token && c.datasetId);
}

/**
 * Post one conversion event. Fail-safe: never throws — attribution reporting must not break a
 * message flow. Returns {skipped} when unconfigured or when there's no ctwa_clid to attribute.
 *
 * @param {object} p
 * @param {"Purchase"|"LeadSubmitted"} p.eventName
 * @param {string} p.ctwaClid              the click id (required — no clid, no attribution)
 * @param {number} [p.value]               Purchase value
 * @param {string} [p.currency]            e.g. "AUD"
 * @param {number} [p.eventTime]           unix seconds (defaults to now)
 */
async function sendConversion({ eventName, ctwaClid, value, currency, eventTime }) {
  if (!isConfigured()) return { skipped: "not_configured" };
  if (!ctwaClid) return { skipped: "no_ctwa_clid" };

  const c = config();
  const event = {
    event_name: eventName,
    event_time: eventTime || Math.floor(Date.now() / 1000),
    action_source: "business_messaging",
    messaging_channel: "whatsapp",
    user_data: {
      ...(c.wabaId ? { whatsapp_business_account_id: c.wabaId } : {}),
      ctwa_clid: ctwaClid,
    },
  };
  if (value != null || currency) {
    event.custom_data = {
      ...(currency ? { currency } : {}),
      ...(value != null ? { value } : {}),
    };
  }

  const url = `https://graph.facebook.com/${c.version}/${c.datasetId}/events?access_token=${encodeURIComponent(c.token)}`;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: [event], partner_agent: PARTNER_AGENT }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error("[meta-capi] send failed:", r.status, JSON.stringify(body).slice(0, 300));
      return { ok: false, status: r.status, body };
    }
    return { ok: true, events_received: body.events_received ?? null };
  } catch (err) {
    console.error("[meta-capi] send error:", err.message);
    return { ok: false, error: err.message };
  }
}

/** Pull the stored click id for a contact (first-touch ad referral). */
function ctwaClidFromContact(contact) {
  return contact?.first_referral?.ctwa_clid || null;
}

/** Report that an ad-sourced contact became a lead (they clicked the ad and messaged us). */
async function reportLead(contact) {
  return sendConversion({ eventName: "LeadSubmitted", ctwaClid: ctwaClidFromContact(contact) });
}

/** Report a purchase by an ad-sourced contact, once an order is linked to them. */
async function reportPurchase(contact, { value, currency = "AUD" } = {}) {
  return sendConversion({ eventName: "Purchase", ctwaClid: ctwaClidFromContact(contact), value, currency });
}

module.exports = { isConfigured, sendConversion, reportLead, reportPurchase, ctwaClidFromContact };
