const { rateLimit } = require("../../lib/shopify");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (await rateLimit(req, res)) return;

  const body = typeof req.body === "object" && req.body ? req.body : {};
  return res.status(201).json({
    client_id: body.client_name
      ? `paintaccess-${String(body.client_name).replace(/[^a-z0-9_-]/gi, "").slice(0, 40)}`
      : "paintaccess-chatgpt",
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: body.redirect_uris || [],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  });
};
