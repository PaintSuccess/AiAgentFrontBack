/**
 * OAuth Callback — receives authorization code from Shopify, exchanges for access token.
 * GET /api/shopify/oauth-callback?code=XXX&shop=XXX&hmac=XXX
 */
const crypto = require("crypto");

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");

  if (req.method !== "GET") {
    return res.status(405).send("Method not allowed");
  }

  const { code, shop, hmac, state, timestamp } = req.query;

  if (!code || !shop) {
    return res.status(400).send(`
      <h1>Missing parameters</h1>
      <p>Expected 'code' and 'shop' query parameters from Shopify OAuth redirect.</p>
    `);
  }

  const clientId = (process.env.SHOPIFY_APP_CLIENT_ID || process.env.SHOPIFY_CLIENT_ID || "").trim();
  const clientSecret = (process.env.SHOPIFY_APP_CLIENT_SECRET || "").trim();

  if (!clientId || !clientSecret) {
    return res.status(500).send(`
      <h1>Server misconfigured</h1>
      <p>SHOPIFY_APP_CLIENT_ID and SHOPIFY_APP_CLIENT_SECRET env vars are required.</p>
    `);
  }

  // Verify HMAC if present
  if (hmac) {
    const params = { ...req.query };
    delete params.hmac;
    const sortedParams = Object.keys(params)
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join("&");
    const computed = crypto
      .createHmac("sha256", clientSecret)
      .update(sortedParams)
      .digest("hex");
    if (computed !== hmac) {
      return res.status(403).send(`
        <h1>HMAC verification failed</h1>
        <p>The request signature is invalid.</p>
      `);
    }
  }

  // Exchange code for access token
  try {
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code: code,
      }),
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok) {
      return res.status(tokenRes.status).send(`
        <h1>Token exchange failed</h1>
        <pre>${JSON.stringify(tokenData, null, 2)}</pre>
      `);
    }

    return res.status(200).send(`
      <html>
      <head><title>Shopify OAuth Success</title></head>
      <body style="font-family: system-ui; max-width: 700px; margin: 40px auto; padding: 20px;">
        <h1 style="color: green;">&#10004; OAuth Successful</h1>
        <p><strong>Scope:</strong> ${escapeHtml(tokenData.scope || "(none)")}</p>
        <p><strong>Expires in:</strong> ${tokenData.expires_in ? tokenData.expires_in + " seconds" : "Never (offline token)"}</p>
        <p><strong>Token (first 8 chars):</strong> ${escapeHtml((tokenData.access_token || "").slice(0, 8))}...</p>
        <hr>
        <p style="color: #666;">The full access token has been logged server-side. Set it as SHOPIFY_ACCESS_TOKEN in your Vercel environment variables. <strong>Do not share this page.</strong></p>
      </body>
      </html>
    `);

    // Log token server-side only (visible in Vercel function logs)
    console.log("[OAuth] Access token obtained:", tokenData.access_token);
  } catch (err) {
    return res.status(500).send(`
      <h1>Error</h1>
      <p>OAuth token exchange failed. Check server logs for details.</p>
    `);
  }
};

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
