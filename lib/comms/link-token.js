/**
 * Signed contact tokens for links WE send.
 *
 * The problem this solves: Shopify's browse events carry no customer identity — by design —
 * so `web_events` is a pile of anonymous `client_id`s. Meta/Google/TikTok can't fix that for
 * us and neither can Google Analytics. But *we* send the WhatsApp messages, so we can put our
 * own marker in the links inside them. When a customer taps a product link we sent, the token
 * rides along in the URL, the pixel reports that URL like any other, and the browser stops
 * being anonymous. No cookie matching, no Shopify approval, no platform cooperation.
 *
 * Stateless on purpose: an HMAC beats a lookup table here because there is no revocation story
 * worth the extra write on every send, and the payload is already tiny.
 *
 * Token layout — 30 bytes, base64url'd to 40 chars, because it has to live in a WhatsApp
 * message a human reads:
 *   [0..16)  contact uuid (raw bytes, not the 36-char text form)
 *   [16..20) expiry, unix seconds, uint32be
 *   [20..30) HMAC-SHA256 over the first 20 bytes, truncated to 10 bytes
 *
 * Truncating the MAC to 80 bits is deliberate: forging one buys an attacker the ability to
 * attribute their own browsing to someone else's contact record. That is a data-quality
 * nuisance, not an escalation — no PII is exposed and nothing is authorised by it. 80 bits is
 * far past the point where that trade makes sense for anyone.
 */
const crypto = require("crypto");
const { cleanEnv } = require("../shopify");

const VERSION_INFO = "pa-link-token-v1";
const DEFAULT_TTL_DAYS = 30;
const MAC_BYTES = 10;
const TOKEN_PARAM = "pa";

/**
 * Derive a key rather than using API_SECRET_TOKEN directly: this token travels in URLs that
 * get forwarded, logged and screenshotted, so it must not share key material with anything
 * that authorises an action. Same secret, separate key, no new env var to configure.
 */
function key() {
  const base = cleanEnv("LINK_TOKEN_SECRET") || cleanEnv("API_SECRET_TOKEN");
  if (!base) return null;
  return crypto.createHmac("sha256", base).update(VERSION_INFO).digest();
}

const b64u = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");

function uuidToBytes(uuid) {
  const hex = String(uuid || "").replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/i.test(hex)) return null;
  return Buffer.from(hex, "hex");
}
function bytesToUuid(buf) {
  const h = buf.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** @returns {string|null} compact token, or null if unsignable (bad id / no secret). */
function signContactToken(contactId, { ttlDays = DEFAULT_TTL_DAYS } = {}) {
  const k = key();
  const id = uuidToBytes(contactId);
  if (!k || !id) return null;
  const head = Buffer.alloc(20);
  id.copy(head, 0);
  head.writeUInt32BE(Math.floor(Date.now() / 1000) + ttlDays * 86400, 16);
  const mac = crypto.createHmac("sha256", k).update(head).digest().subarray(0, MAC_BYTES);
  return b64u(Buffer.concat([head, mac]));
}

/** @returns {string|null} contact uuid, or null if forged, malformed or expired. */
function verifyContactToken(token) {
  const k = key();
  if (!k || !token) return null;
  let raw;
  try {
    raw = unb64u(token);
  } catch {
    return null;
  }
  if (raw.length !== 20 + MAC_BYTES) return null;

  const head = raw.subarray(0, 20);
  const mac = raw.subarray(20);
  const expected = crypto.createHmac("sha256", k).update(head).digest().subarray(0, MAC_BYTES);
  // timingSafeEqual throws on length mismatch; lengths are fixed above, so this is safe.
  if (!crypto.timingSafeEqual(mac, expected)) return null;

  if (head.readUInt32BE(16) < Math.floor(Date.now() / 1000)) return null;
  return bytesToUuid(head.subarray(0, 16));
}

/** Hosts whose links we're willing to tag. */
function storefrontHosts() {
  const raw = cleanEnv("STOREFRONT_HOSTS") || "paintaccess.com.au,www.paintaccess.com.au";
  return raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/**
 * Tag every storefront link in an outbound message body with the contact's token.
 *
 * Only our own storefront hosts are touched. A message may also contain a wa.me handoff link,
 * a supplier's site, or a tracking URL — appending an identity token to someone else's domain
 * would leak who the customer is to a third party, so host matching is an allowlist, never a
 * blanket regex over every http(s) URL.
 */
function tagLinks(body, contactId) {
  const text = String(body || "");
  if (!text || !contactId) return text;
  const token = signContactToken(contactId);
  if (!token) return text;
  const hosts = storefrontHosts();

  return text.replace(/https?:\/\/[^\s<>"')]+/gi, (match) => {
    // A URL at the end of a sentence pulls the sentence's punctuation into the match
    // ("...sprayer." / "...cart,"). Left in, it becomes part of the path and corrupts the
    // customer-facing link. Peel trailing punctuation off, tag the clean URL, put it back.
    const punct = match.match(/[.,;:!?]+$/);
    const trailer = punct ? punct[0] : "";
    const clean = trailer ? match.slice(0, -trailer.length) : match;
    let url;
    try {
      url = new URL(clean);
    } catch {
      return match;
    }
    if (!hosts.includes(url.hostname.toLowerCase())) return match;
    if (url.searchParams.has(TOKEN_PARAM)) return match; // already tagged
    url.searchParams.set(TOKEN_PARAM, token);
    return url.toString() + trailer;
  });
}

/** Pull a contact id out of a URL a pixel reported. */
function contactIdFromUrl(rawUrl) {
  try {
    const value = new URL(String(rawUrl)).searchParams.get(TOKEN_PARAM);
    return value ? verifyContactToken(value) : null;
  } catch {
    return null;
  }
}

module.exports = { signContactToken, verifyContactToken, tagLinks, contactIdFromUrl, TOKEN_PARAM };
