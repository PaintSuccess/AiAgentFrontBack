/**
 * Shared Shopify/formatting helpers for dashboard pages.
 */

export const ADMIN_BASE = "https://admin.shopify.com/store/zgmzge-0d";

/**
 * Extract the numeric id from a GraphQL GID ("gid://shopify/Order/123" -> "123").
 *
 * Admin URLs need the bare numeric id. The two order sources in this app disagree:
 * `api/comms/contact.js` fetches orders over REST (numeric ids already), while
 * `api/comms/orders.js` goes through shopify-ops GraphQL and returns GIDs. Passing a
 * GID straight into an admin link silently produces a broken URL, so route GraphQL
 * ids through here. Already-numeric ids pass through unchanged.
 */
export function gidToId(gid) {
  const s = String(gid || "");
  if (!s) return "";
  const m = s.match(/\/(\d+)(?:\?.*)?$/);
  return m ? m[1] : s;
}

export const money = (v, cur) =>
  v == null ? "" : `${cur || "AUD"} ${Number(v).toLocaleString("en-AU", { minimumFractionDigits: 2 })}`;

export const dateShort = (iso) =>
  iso ? new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : "";

/**
 * shopify-ops pre-formats money server-side as "123.45 AUD" (lib/shopify-ops.js
 * `money()`), so it can't go through `money()` above. Re-render it in the hub's
 * house style ("AUD 123.45"). Falls back to the raw string if it doesn't parse.
 */
export function formatOpsMoney(total) {
  const s = String(total || "").trim();
  if (!s) return "";
  const m = s.match(/^([\d,.-]+)\s*([A-Za-z]{3})?$/);
  if (!m) return s;
  const amount = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(amount)) return s;
  return money(amount, m[2] ? m[2].toUpperCase() : undefined);
}

/** "PARTIALLY_REFUNDED" / "partially_refunded" -> "Partially refunded". */
const humanizeStatus = (v) => {
  const s = String(v || "").replace(/_/g, " ").trim().toLowerCase();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
};

/**
 * Badge colours for an order's financial/fulfillment state.
 *
 * Case-insensitive on purpose: the two order sources disagree on casing. REST
 * (`api/comms/contact.js`) yields lowercase "paid"; GraphQL (`api/comms/orders.js`)
 * yields SCREAMING_SNAKE enums like "PAID"/"PARTIALLY_REFUNDED".
 */
export function statusTone(fin, ful) {
  const f = String(fin || "").toLowerCase();
  const u = String(ful || "").toLowerCase();
  if (f === "paid") return { bg: "#e7f6ec", color: "#1a7f43", label: "Paid" };
  if (u === "fulfilled") return { bg: "#e7f6ec", color: "#1a7f43", label: "Fulfilled" };
  if (f === "refunded") return { bg: "#fdecea", color: "#b42318", label: "Refunded" };
  return { bg: "#fef7e6", color: "#b25c00", label: humanizeStatus(fin) || humanizeStatus(ful) || "Open" };
}
