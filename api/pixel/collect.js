/**
 * POST /api/pixel/collect — storefront behaviour from our own Shopify custom pixel.
 *
 * PUBLIC BY NECESSITY: browsers call this directly, so there is no token to check and
 * anything arriving here is untrusted. It is therefore written to be boring — an allowlist
 * of event names, hard length caps, a batch cap, and a rate limit. It stores no PII and
 * never reads the request as instructions.
 *
 * We deliberately subscribe to browse/cart events only (see the pixel snippet in
 * `_store/setup/custom-pixel.js`). The checkout_* events are the only ones carrying customer
 * PII, and we already get orders authoritatively from the Shopify Admin API — so taking them
 * here would duplicate data we hold, add a PII surface on an open endpoint, and gain nothing.
 *
 * Fail-safe: a bad payload is dropped with 204, never a 4xx. This endpoint must never become
 * a reason the storefront logs errors at a customer.
 */
const { cleanEnv, rateLimit } = require("../../lib/shopify");
const { getSupabase } = require("../../lib/supabase");

// Shopify's browse/cart standard events. Anything else is ignored rather than stored —
// an open endpoint should not let callers invent event types in our schema.
const ALLOWED = new Set([
  "page_viewed",
  "product_viewed",
  "collection_viewed",
  "search_submitted",
  "product_added_to_cart",
  "product_removed_from_cart",
  "cart_viewed",
]);

const MAX_EVENTS = 30;
const MAX_LEN = 500;
const MAX_BODY = 64 * 1024;

const str = (v, max = MAX_LEN) => {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : null;
};
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * CORS.
 *
 * `null` MUST be allowed. Shopify runs custom pixels in an iframe sandboxed with
 * `allow-scripts allow-forms` and deliberately WITHOUT `allow-same-origin`, so the pixel has
 * an opaque origin and every request it makes carries `Origin: null`. Rejecting that rejects
 * the only caller we actually want — verified live 2026-07-16: beacons were dropped silently
 * with no error anywhere.
 *
 * This costs nothing in security, because an origin allowlist was never a security boundary
 * here: CORS governs what a *browser* may read from a response, not whether the request runs.
 * A plain curl sends no Origin at all and is processed regardless. The real protections are
 * the event allowlist, the length/batch caps, the rate limit, and storing no PII.
 */
function corsFor(res, req) {
  const allowed = (cleanEnv("PIXEL_ALLOWED_ORIGINS") || "https://www.paintaccess.com.au,https://paintaccess.com.au")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const origin = String(req.headers.origin || "");
  if (origin === "null" || allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin === "null" ? "null" : origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function normalize(clientId, raw) {
  const name = str(raw?.name, 60);
  if (!name || !ALLOWED.has(name)) return null;
  const p = raw.product || {};
  return {
    client_id: clientId,
    name,
    url: str(raw.url, 1000),
    referrer: str(raw.referrer, 1000),
    product_id: str(p.id, 80),
    product_title: str(p.title, 300),
    variant_id: str(p.variantId, 80),
    price: num(p.price),
    currency: str(p.currency, 10),
    data: raw.query ? { query: str(raw.query, 200) } : null,
    occurred_at: raw.occurredAt && !Number.isNaN(Date.parse(raw.occurredAt))
      ? new Date(raw.occurredAt).toISOString()
      : new Date().toISOString(),
  };
}

module.exports = async function handler(req, res) {
  corsFor(res, req);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (await rateLimit(req, res)) return;

  try {
    const body = req.body || {};
    if (JSON.stringify(body).length > MAX_BODY) return res.status(204).end();

    const clientId = str(body.clientId, 120);
    const events = Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS) : [];
    if (!clientId || !events.length) return res.status(204).end();

    const rows = events.map((e) => normalize(clientId, e)).filter(Boolean);
    if (!rows.length) return res.status(204).end();

    const sb = getSupabase();
    if (!sb) return res.status(204).end();
    const { error } = await sb.from("web_events").insert(rows);
    if (error) console.error("[pixel/collect] insert failed:", error.message);
  } catch (err) {
    console.error("[pixel/collect]", err.message);
  }
  // Always 204: the pixel is fire-and-forget and must never surface an error to a shopper.
  return res.status(204).end();
};
