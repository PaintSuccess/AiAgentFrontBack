const crypto = require("crypto");
const { cleanEnv } = require("../../lib/shopify");

const DEFAULT_SCOPES = [
  "read_products",
  "read_inventory",
  "read_orders",
  "write_orders",
  "read_assigned_fulfillment_orders",
  "write_assigned_fulfillment_orders",
  "read_merchant_managed_fulfillment_orders",
  "write_merchant_managed_fulfillment_orders",
  "read_third_party_fulfillment_orders",
  "write_third_party_fulfillment_orders",
  "read_fulfillments",
  "write_fulfillments",
  "read_customers",
  "write_customers",
  "read_draft_orders",
  "write_draft_orders",
].join(",");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).send("Method not allowed");

  const clientId = cleanEnv("SHOPIFY_APP_CLIENT_ID") || cleanEnv("SHOPIFY_CLIENT_ID");
  const store = cleanShop(req.query.shop || cleanEnv("SHOPIFY_STORE"));
  if (!clientId || !store) {
    return res.status(500).send("SHOPIFY_APP_CLIENT_ID and SHOPIFY_STORE are required.");
  }

  const baseUrl =
    cleanEnv("PUBLIC_BASE_URL") ||
    cleanEnv("BACKEND_URL") ||
    `https://${req.headers["x-forwarded-host"] || req.headers.host}`;
  const redirectUri = `${String(baseUrl).replace(/\/+$/, "")}/api/shopify/oauth-callback`;
  const scopes = mergeScopes(cleanEnv("SHOPIFY_APP_SCOPES"), DEFAULT_SCOPES);
  const state = crypto.randomBytes(16).toString("hex");
  const params = new URLSearchParams({
    client_id: clientId,
    scope: scopes,
    redirect_uri: redirectUri,
    state,
  });

  return res.redirect(302, `https://${store}/admin/oauth/authorize?${params}`);
};

function cleanShop(value) {
  const shop = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) return "";
  return shop;
}

function mergeScopes(...scopeSets) {
  const scopes = [];
  for (const set of scopeSets) {
    for (const scope of String(set || "").split(",")) {
      const clean = scope.trim();
      if (clean && !scopes.includes(clean)) scopes.push(clean);
    }
  }
  return scopes.join(",");
}
