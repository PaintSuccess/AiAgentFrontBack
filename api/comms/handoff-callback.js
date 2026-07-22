/**
 * POST /api/comms/handoff-callback — website-widget phone capture (Option C).
 *
 * When an anonymous widget visitor asks for a human, the escalation offers a
 * WhatsApp button AND a "leave your mobile, we'll text you" field. Submitting the
 * field lands here: we open the SMS relay to that number so a real person picks
 * up in a text thread — no WhatsApp/app-switch needed.
 *
 * This is PUBLIC (the widget is client-side and can't hold API_SECRET_TOKEN) and
 * it PAGES REAL STAFF, so it is defended in depth:
 *   1. a signed, short-lived handoff_token minted by the escalation that offered
 *      the field (verifyHandoffToken) — a random script can't forge one;
 *   2. a strict dedicated per-IP rate limit (tighter than the global one);
 *   3. AU-mobile validation with the AU-aware normalizePhone (NOT normalizeE164,
 *      which mangles free-text AU numbers — see project memory).
 */
const { corsHeaders, checkRateLimit, sanitizeInput } = require("../../lib/shopify");
const { normalizePhone } = require("../../lib/shopify-customer-context");
const { escalateToHuman, verifyHandoffToken, handoffTokenId } = require("../../lib/comms/handoff");

const CALL_US = "Please call us on 02 5838 5959 and the team will help you straight away.";

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Dedicated, strict per-IP limit — this endpoint pages real people and sends SMS.
  // (x-forwarded-for can arrive as an array behind some proxies; handle both.)
  const xff = req.headers["x-forwarded-for"];
  const ip =
    (Array.isArray(xff) ? xff[0] : String(xff || "")).split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    "unknown";
  if (await checkRateLimit(`handoff-cb:${ip}`, 4, 600)) {
    return res.status(429).json({ error: `Too many attempts. ${CALL_US}` });
  }

  const body = req.body || {};

  if (!verifyHandoffToken(body.token)) {
    return res.status(403).json({ error: "This request has expired — please ask to speak with a human again." });
  }

  const phone = normalizePhone(body.phone);
  // AU mobile only: +61 4xx xxx xxx. The relay opener is an SMS, and this is an
  // AU store, so reject anything that isn't a mobile we can actually text back.
  if (!/^\+614\d{8}$/.test(phone)) {
    return res.status(400).json({ error: "Please enter a valid Australian mobile number (04xx xxx xxx)." });
  }

  // Single-use token FIRST — one accepted callback per genuine escalation. Without
  // this, a token captured from one real escalation could be replayed for many
  // different numbers within its 15-min window (spray/bomb). The signature is
  // unique per token; consuming it here (max 1 per its TTL) makes replays a 409.
  // It runs BEFORE the per-phone gate on purpose: a replayed (already-used) token
  // must be rejected without spending an innocent victim's per-phone budget.
  // Trade-off: the token is consumed before escalateToHuman, so a transient
  // failure there (502 below) burns this one-time token — the customer just asks
  // for a human again to get a fresh one. Consuming AFTER the send would reopen
  // the spray hole, so this ordering is deliberate.
  if (await checkRateLimit(`handoff-tok:${handoffTokenId(body.token)}`, 1, 900)) {
    return res.status(409).json({ error: "That request was already used — please ask to speak with a human again." });
  }

  // Per-phone cap — the anti-SMS-bomb gate. No matter the IP or how many valid
  // tokens an attacker collects, we never text one number more than twice an hour.
  if (await checkRateLimit(`handoff-phone:${phone}`, 2, 3600)) {
    return res.status(429).json({ error: `We've already texted that number recently. ${CALL_US}` });
  }

  try {
    const result = await escalateToHuman({
      channel: "widget",
      phone,
      reason: sanitizeInput(body.reason, 300) || "Website chat — asked to speak with a person",
    });
    return res.status(200).json({
      ok: true,
      message: result?.message || "Thanks — we'll text you now. Check your phone for a message from Paint Access.",
    });
  } catch (err) {
    console.error("[handoff-callback]", err.message);
    return res.status(502).json({ error: `We couldn't reach the team automatically just now. ${CALL_US}` });
  }
};
