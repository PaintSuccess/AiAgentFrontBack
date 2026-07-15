/**
 * OAuth Callback — receives authorization code from Shopify, exchanges for access token.
 * GET /api/shopify/oauth-callback?code=XXX&shop=XXX&hmac=XXX
 */
const crypto = require("crypto");
const { cleanEnv } = require("../../lib/shopify");
const { triggerDeployHook, upsertVercelEnv } = require("../../lib/vercel-env");

// `shop` is interpolated into the token-exchange URL below, and that request carries
// SHOPIFY_APP_CLIENT_SECRET. Anything but a real Shopify shop domain here means we
// would hand the app secret to whoever the caller names, so this is an allowlist, not
// a sanity check. Shopify shop domains are always "<handle>.myshopify.com".
const SHOP_DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

function isValidShopDomain(shop) {
  return SHOP_DOMAIN_RE.test(String(shop || "").trim().toLowerCase());
}

function timingSafeEqualHex(a, b) {
  const bufA = Buffer.from(String(a || ""), "utf8");
  const bufB = Buffer.from(String(b || ""), "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

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

  if (!isValidShopDomain(shop)) {
    return res.status(400).send(`
      <h1>Invalid shop</h1>
      <p>'shop' must be a myshopify.com domain.</p>
    `);
  }

  const clientId = cleanEnv("SHOPIFY_APP_CLIENT_ID") || cleanEnv("SHOPIFY_CLIENT_ID");
  const clientSecret = cleanEnv("SHOPIFY_APP_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    return res.status(500).send(`
      <h1>Server misconfigured</h1>
      <p>SHOPIFY_APP_CLIENT_ID and SHOPIFY_APP_CLIENT_SECRET env vars are required.</p>
    `);
  }

  // HMAC is REQUIRED. It used to be verified only `if (hmac)`, which meant an attacker
  // could skip the check entirely just by omitting the parameter — and the request below
  // sends our client secret, so an unverified caller must never reach it.
  if (!hmac) {
    return res.status(403).send(`
      <h1>Missing signature</h1>
      <p>The 'hmac' parameter is required on the Shopify OAuth redirect.</p>
    `);
  }

  {
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
    if (!timingSafeEqualHex(computed, hmac)) {
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

    console.log("[OAuth] Access token obtained with scope:", tokenData.scope || "(none)");
    const token = tokenData.access_token || "";
    const storeResult = await upsertVercelEnv(
      {
        SHOPIFY_ACCESS_TOKEN: token,
        ...(tokenData.scope ? { SHOPIFY_APP_SCOPES: tokenData.scope } : {}),
      },
      {
        targets: cleanEnv("SHOPIFY_OAUTH_VERCEL_TARGETS") || cleanEnv("VERCEL_ENV_TARGETS") || "production",
        comment: "Updated by PaintAccess Shopify OAuth callback.",
      }
    );
    const deployResult = storeResult.ok
      ? await triggerDeployHook(["SHOPIFY_OAUTH_DEPLOY_HOOK_URL"])
      : { skipped: true };
    const stored = storeResult.ok && !storeResult.skipped;

    return res.status(200).send(`
      <html>
      <head><title>Shopify OAuth Success</title></head>
      <body style="font-family: system-ui; max-width: 700px; margin: 40px auto; padding: 20px;">
        <h1 style="color: green;">&#10004; OAuth Successful</h1>
        <p><strong>Scope:</strong> ${escapeHtml(tokenData.scope || "(none)")}</p>
        <p><strong>Expires in:</strong> ${tokenData.expires_in ? tokenData.expires_in + " seconds" : "Never (offline token)"}</p>
        <p><strong>Token (first 8 chars):</strong> ${escapeHtml(token.slice(0, 8))}...</p>
        <p><strong>Vercel auto-store:</strong> ${stored ? "completed" : "not completed"}</p>
        <p><strong>Deploy hook:</strong> ${
          deployResult.skipped ? "not configured" : deployResult.ok ? "triggered" : "failed"
        }</p>
        ${
          stored
            ? "<p>The token was written to Vercel. If no deploy hook is configured, redeploy production so the running backend picks up the new env var.</p>"
            : `<p>Copy this token into Vercel as <code>SHOPIFY_ACCESS_TOKEN</code>, then redeploy production.</p>
               <textarea readonly style="width:100%; min-height:120px; font-family: ui-monospace, SFMono-Regular, Consolas, monospace;">${escapeHtml(token)}</textarea>`
        }
        <details>
          <summary>Technical result</summary>
          <pre>${escapeHtml(JSON.stringify({ storeResult, deployResult }, null, 2))}</pre>
        </details>
        <hr>
        <p style="color: #666;">Do not share this page. Close it after updating Vercel.</p>
      </body>
      </html>
    `);
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
