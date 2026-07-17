/**
 * PaintAccess — Shopify CUSTOM PIXEL
 * ============================================================================
 * PASTE THIS INTO: Shopify admin → Settings → Customer events → Add custom pixel
 *                  Name it "PaintAccess AI" → paste → Save → Connect.
 *
 * This file is the source of truth. It is NOT loaded from the repo at runtime — Shopify
 * stores its own copy, so any change here must be re-pasted to take effect.
 * ============================================================================
 *
 * What it does: forwards what shoppers browse to our own backend, so the AI can see it.
 * Meta, Google, TikTok and Omnisend already have this; we didn't.
 *
 * What it does NOT do: no checkout events, so no names, emails, phones or addresses ever
 * reach this endpoint. Only what was looked at — never who. Identity is joined later, on our
 * side, from a token in the links we send.
 *
 * Events are batched and sent with fetch(keepalive) so a shopper never waits on us, and a
 * failure here can never affect the storefront.
 *
 * ⚠ DO NOT reach for `navigator.sendBeacon` here. Shopify's pixel sandbox guarantees only
 * `console` and the timer functions — other globals "will be explicitly overwritten to be
 * undefined", and `navigator` is one of them. An earlier version used sendBeacon inside a
 * try/catch: the ReferenceError was swallowed and the pixel sent absolutely nothing, with no
 * error in the page, no network entry, and no server log. Shopify's own docs point at
 * fetch + keepalive, which survives page navigation the same way.
 */
const ENDPOINT = "https://ai-agent-front-back.vercel.app/api/pixel/collect";

const BATCH_MS = 2000;   // group rapid events into one request
const MAX_BATCH = 20;

let queue = [];
let timer = null;

function flush() {
  if (!queue.length) return;
  const payload = JSON.stringify({
    // Shopify's anonymous browser id. Stable across the visit; not a person.
    clientId: queue[0].clientId,
    events: queue.map(({ clientId, ...e }) => e),
  });
  queue = [];
  // keepalive lets the request outlive the page — a product_viewed fired as the shopper
  // clicks away is exactly the event we most want, and would otherwise be lost.
  // Failures are logged, never thrown: `console` is one of the two guaranteed globals, and a
  // silent catch here is what hid the original bug.
  fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
    keepalive: true,
  }).catch((err) => console.error("[PaintAccess AI pixel] send failed:", err));
}

function push(clientId, name, data) {
  queue.push({ clientId, name, ...data });
  if (queue.length >= MAX_BATCH) { clearTimeout(timer); return flush(); }
  clearTimeout(timer);
  timer = setTimeout(flush, BATCH_MS);
}

function ctx(event) {
  const d = event.context && event.context.document;
  return {
    occurredAt: event.timestamp,
    url: d && d.location ? d.location.href : undefined,
    referrer: d ? d.referrer : undefined,
  };
}

function productOf(v) {
  const pv = v && v.productVariant;
  if (!pv) return undefined;
  return {
    id: pv.product && pv.product.id,
    title: pv.product && pv.product.title,
    variantId: pv.id,
    price: pv.price && pv.price.amount,
    currency: pv.price && pv.price.currencyCode,
  };
}

analytics.subscribe("page_viewed", (e) => push(e.clientId, "page_viewed", ctx(e)));

analytics.subscribe("product_viewed", (e) =>
  push(e.clientId, "product_viewed", { ...ctx(e), product: productOf(e.data) })
);

analytics.subscribe("collection_viewed", (e) =>
  push(e.clientId, "collection_viewed", {
    ...ctx(e),
    product: e.data && e.data.collection ? { title: e.data.collection.title, id: e.data.collection.id } : undefined,
  })
);

analytics.subscribe("search_submitted", (e) =>
  push(e.clientId, "search_submitted", { ...ctx(e), query: e.data && e.data.searchResult && e.data.searchResult.query })
);

analytics.subscribe("product_added_to_cart", (e) =>
  push(e.clientId, "product_added_to_cart", { ...ctx(e), product: productOf(e.data && e.data.cartLine && e.data.cartLine.merchandise ? { productVariant: e.data.cartLine.merchandise } : undefined) })
);

analytics.subscribe("product_removed_from_cart", (e) =>
  push(e.clientId, "product_removed_from_cart", { ...ctx(e), product: productOf(e.data && e.data.cartLine && e.data.cartLine.merchandise ? { productVariant: e.data.cartLine.merchandise } : undefined) })
);

analytics.subscribe("cart_viewed", (e) => push(e.clientId, "cart_viewed", ctx(e)));
