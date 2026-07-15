const { shopifyFetch } = require("./shopify");
const {
  normalizePhone,
  phoneSearchVariants,
  getRecentOrdersForCustomer,
} = require("./shopify-customer-context");

function normalizeOrderNumber(value) {
  const raw = String(value || "").trim();
  // Bounded to this store's order-number length (currently 5 digits, e.g. #44550) so a
  // phone number or other long digit string embedded in the message text can never be
  // mistaken for an order number. Both \b's are required: without the leading one, a
  // greedy match can still land on a 3-7 digit tail slice of a longer run.
  const match = raw.match(/#?\s*\b(\d{3,7})\b/);
  return match ? `#${match[1]}` : "";
}

function extractOrderNumber(text) {
  return normalizeOrderNumber(text);
}

function extractEmail(text) {
  const match = String(text || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : "";
}

// Bare logistics words ("shipping", "delivery", "status", "tracking") also show up in
// generic company-info questions ("do you ship to X?", "what's your delivery method?"),
// so intent requires those words to be tied to "order"/"orders", or an explicit
// "my order/package/parcel/delivery" phrase — not just present anywhere in the message.
// [^.!?]* keeps the two halves within roughly the same sentence.
const ORDER_STATUS_WORDS =
  "(?:status|number|track(?:ing)?|shipped|dispatch(?:ed)?|deliver(?:y|ed)?|arrive(?:d)?|fulfil(?:l)?ment|fulfil(?:l)?ed|where|late|delayed)";
const ORDER_THEN_STATUS_RE = new RegExp(`\\b(?:order|orders)\\b[^.!?]*\\b${ORDER_STATUS_WORDS}\\b`, "i");
const STATUS_THEN_ORDER_RE = new RegExp(`\\b${ORDER_STATUS_WORDS}\\b[^.!?]*\\b(?:order|orders)\\b`, "i");
const MY_ORDER_RE = /\bmy (?:orders?|package|parcel|delivery)\b/i;

function looksLikeOrderIntent(text) {
  const t = String(text || "");
  return ORDER_THEN_STATUS_RE.test(t) || STATUS_THEN_ORDER_RE.test(t) || MY_ORDER_RE.test(t);
}

function formatDate(isoDate) {
  if (!isoDate) return "";
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Australia/Sydney",
  });
}

function safeOrderSummary(order = {}) {
  const fulfillments = (order.fulfillments || []).map((f) => ({
    status: f.status || null,
    tracking_number: f.tracking_number || null,
    tracking_url: f.tracking_url || null,
    tracking_company: f.tracking_company || null,
    created_at: f.created_at || null,
  }));

  return {
    order_number: order.name || normalizeOrderNumber(order.order_number),
    created_at: order.created_at || null,
    financial_status: order.financial_status || null,
    fulfillment_status: order.fulfillment_status || "unfulfilled",
    total_price: order.total_price || null,
    currency: order.currency || "AUD",
    // Customer-facing secure order page (Shopify). The canonical "view my order" link.
    order_status_url: order.order_status_url || null,
    line_items: (order.line_items || []).slice(0, 6).map((item) => ({
      title: item.title,
      quantity: item.quantity,
      price: item.price,
    })),
    fulfillments,
  };
}

/** First available carrier tracking URL, if any. */
function primaryTrackingUrl(summary) {
  const f = (summary.fulfillments || []).find((x) => x.tracking_url);
  return f ? f.tracking_url : null;
}

/**
 * Structured payload for the on-screen order card in the website widget
 * (mirrors display_products_in_chat_payload). Links live here — the spoken
 * `message` stays URL-free so voice never reads a URL aloud.
 */
function displayOrderPayload(summary) {
  return {
    order_number: summary.order_number,
    date: formatDate(summary.created_at),
    payment_status: summary.financial_status || null,
    fulfillment_status: summary.fulfillment_status || null,
    total: summary.total_price ? `${summary.total_price} ${summary.currency || "AUD"}` : null,
    items: (summary.line_items || []).map((i) => ({
      title: i.title,
      quantity: i.quantity,
    })),
    order_url: summary.order_status_url || null,
    tracking_url: primaryTrackingUrl(summary),
    tracking_company: (summary.fulfillments || []).find((x) => x.tracking_company)?.tracking_company || null,
  };
}

// Spoken/base summary tracking text — carrier + number only, NO raw URL (so voice
// never reads a URL aloud; the clickable link is delivered via the order card on
// the widget, or appended to the text reply on SMS/WhatsApp).
function trackingText(order) {
  const links = (order.fulfillments || [])
    .map((f) => {
      const parts = [];
      if (f.tracking_company) parts.push(f.tracking_company);
      if (f.tracking_number) parts.push(f.tracking_number);
      return parts.join(" ");
    })
    .filter(Boolean);

  return links.length ? links.join("\n") : "";
}

function formatOrderReply(order) {
  const safe = safeOrderSummary(order);
  const status = [
    safe.financial_status ? `payment ${safe.financial_status}` : null,
    `fulfilment ${safe.fulfillment_status || "unfulfilled"}`,
  ].filter(Boolean).join(", ");
  const items = safe.line_items
    .slice(0, 3)
    .map((item) => `${item.title} x${item.quantity}`)
    .join("; ");
  const track = trackingText(safe);

  return [
    `I found ${safe.order_number}${safe.created_at ? ` from ${formatDate(safe.created_at)}` : ""}.`,
    status ? `Status: ${status}.` : null,
    safe.total_price ? `Total: ${safe.total_price} ${safe.currency || "AUD"}.` : null,
    items ? `Items: ${items}.` : null,
    track ? `Tracking:\n${track}` : "No tracking link is showing yet. If it has only just shipped, tracking can appear after the courier scans it.",
  ].filter(Boolean).join("\n");
}

function formatRecentOrdersReply(orders = []) {
  if (!orders.length) {
    return "I found your customer profile from this phone number, but I can't see any recent orders attached to it.";
  }

  const lines = orders.slice(0, 3).map((order, index) => {
    const safe = safeOrderSummary(order);
    const status = safe.fulfillment_status || "unfulfilled";
    const items = safe.line_items
      .slice(0, 2)
      .map((item) => `${item.title} x${item.quantity}`)
      .join("; ");
    return `${index + 1}. ${safe.order_number}${safe.created_at ? ` (${formatDate(safe.created_at)})` : ""} - ${status}${items ? ` - ${items}` : ""}`;
  });

  return `I found these recent orders for this phone number:\n${lines.join("\n")}\n\nTell me the order number if you want tracking or more detail.`;
}

async function fetchOrderByNumber(orderNumber) {
  const normalized = normalizeOrderNumber(orderNumber);
  if (!normalized) return null;
  const clean = normalized.replace(/^#/, "");
  const data = await shopifyFetch(`orders.json?name=%23${encodeURIComponent(clean)}&status=any&limit=1`);
  return (data.orders || [])[0] || null;
}

function collectOrderPhones(order = {}) {
  return [
    order.phone,
    order.customer?.phone,
    order.customer?.default_address?.phone,
    order.shipping_address?.phone,
    order.billing_address?.phone,
  ].filter(Boolean);
}

function orderMatchesPhone(order, phone) {
  const target = normalizePhone(phone);
  if (!target) return false;
  const variants = new Set(phoneSearchVariants(target).map((value) => value.replace(/\D/g, "")));
  return collectOrderPhones(order).some((value) => variants.has(normalizePhone(value).replace(/\D/g, "")));
}

function orderMatchesCustomer(order, identity = {}) {
  const customerId = String(identity.customerId || "").trim();
  const email = String(identity.email || "").trim().toLowerCase();
  const customerEmail = String(identity.customerEmail || "").trim().toLowerCase();
  const phone = identity.customerPhone || "";

  if (customerId && String(order.customer?.id || "") === customerId) return true;
  if (email && String(order.email || "").toLowerCase() === email) return true;
  if (customerEmail && String(order.email || "").toLowerCase() === customerEmail) return true;
  if (phone && orderMatchesPhone(order, phone)) return true;

  return false;
}

async function lookupCustomerOrder({
  orderNumber = "",
  email = "",
  customerId = "",
  customerEmail = "",
  customerPhone = "",
  recentOrders = [],
} = {}) {
  const normalizedOrder = normalizeOrderNumber(orderNumber);
  const hasTrustedCustomer = Boolean(customerId || customerPhone);

  if (!normalizedOrder) {
    if (!hasTrustedCustomer || !customerId) {
      return {
        found: false,
        needsVerification: true,
        message: "For security, please send your order number and the email used for that order.",
      };
    }
    const orders = recentOrders.length
      ? recentOrders
      : await getRecentOrdersForCustomer(customerId, 3);
    return {
      found: Boolean(orders.length),
      orders: orders.map(safeOrderSummary),
      message: formatRecentOrdersReply(orders),
    };
  }

  if (!hasTrustedCustomer && !email) {
    return {
      found: false,
      needsVerification: true,
      message: "For security, please send the email used for that order as well.",
    };
  }

  const order = await fetchOrderByNumber(normalizedOrder);
  if (!order) {
    return {
      found: false,
      message: `I couldn't find order ${normalizedOrder}. Please check the number and try again.`,
    };
  }

  if (!orderMatchesCustomer(order, { customerId, customerEmail, customerPhone, email })) {
    const clean = normalizedOrder.replace(/^#/, "");
    return {
      found: false,
      message: email
        ? `Order #${clean} was not found for those details. Please check the order number and email used at checkout.`
        : `I found order #${clean}, but it is not attached to the verified customer details for this chat. For security, please send the email used for that order.`,
    };
  }

  const summary = safeOrderSummary(order);
  return {
    found: true,
    orders: [summary],
    message: formatOrderReply(order),
    order_link: summary.order_status_url || null,
    tracking_link: primaryTrackingUrl(summary),
    display_order_payload: displayOrderPayload(summary),
  };
}

module.exports = {
  extractEmail,
  extractOrderNumber,
  formatOrderReply,
  formatRecentOrdersReply,
  looksLikeOrderIntent,
  lookupCustomerOrder,
  normalizeOrderNumber,
  safeOrderSummary,
  displayOrderPayload,
  primaryTrackingUrl,
};
