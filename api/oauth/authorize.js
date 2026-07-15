const {
  DEFAULT_SCOPES,
  createAuthorizationCode,
  getQueryParam,
  htmlEscape,
  isAllowedRedirectUri,
  parseBody,
  safeEqual,
} = require("../../lib/mcp-auth");
const { cleanEnv, rateLimit } = require("../../lib/shopify");

module.exports = async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    return res.status(405).send("Method not allowed");
  }
  // Rate-limited especially because POST here is where the MCP_OAUTH_PIN is
  // guessed against -- without this, safeEqual's timing-safety doesn't stop
  // an attacker from just trying many PINs quickly.
  if (await rateLimit(req, res)) return;

  const input = req.method === "GET" ? req.query || {} : parseBody(req);
  const params = normalizeAuthorizeParams(input, req);

  if (params.response_type !== "code") return res.status(400).send("Unsupported response_type.");
  if (!params.client_id) return res.status(400).send("Missing client_id.");
  if (!isAllowedRedirectUri(params.redirect_uri)) return res.status(400).send("Unsupported redirect_uri.");

  // PKCE is required (see verifyPkce). Reject here rather than at the token endpoint so
  // a non-PKCE client fails immediately with a clear reason instead of after consent.
  if (!params.code_challenge) {
    return res.status(400).send("PKCE required: missing code_challenge.");
  }
  if (String(params.code_challenge_method || "S256").toUpperCase() !== "S256") {
    return res.status(400).send("PKCE required: code_challenge_method must be S256.");
  }

  const pin = cleanEnv("MCP_OAUTH_PIN");
  const isProduction = cleanEnv("VERCEL_ENV") === "production";
  // Auto-approve is a local/preview convenience and must never apply in production --
  // same rule verifyMcpRequest() already applies to its unauthenticated escape hatch.
  const autoApprove = cleanEnv("MCP_OAUTH_AUTO_APPROVE") === "true" && !isProduction;

  // A missing PIN must not mean "everybody passes". `pinOk = !pin || ...` did exactly
  // that: with no MCP_OAUTH_PIN set, anyone could POST approve=1 and be issued an
  // authorization code for the full Operations MCP scope, with no human involved.
  // Without a configured PIN there is no way to prove the approver is staff, so refuse
  // to issue codes at all.
  if (!autoApprove && !pin) {
    return res.status(503).send(
      "<h1>OAuth is not configured</h1>" +
        "<p>Set <code>MCP_OAUTH_PIN</code> before authorizing a connector.</p>"
    );
  }

  const approved = req.method === "POST" && input.approve === "1";
  const pinOk = safeEqual(input.pin || "", pin);

  if (!autoApprove && (!approved || !pinOk)) {
    return res
      .status(200)
      .setHeader("Content-Type", "text/html; charset=utf-8")
      .send(renderAuthorizePage(params, { pinRequired: Boolean(pin), pinError: Boolean(input.pin && !pinOk) }));
  }

  const code = createAuthorizationCode({
    client_id: params.client_id,
    redirect_uri: params.redirect_uri,
    code_challenge: params.code_challenge,
    code_challenge_method: params.code_challenge_method || "S256",
    scope: params.scope || DEFAULT_SCOPES.join(" "),
    resource: params.resource || "",
  });

  const redirect = new URL(params.redirect_uri);
  redirect.searchParams.set("code", code);
  if (params.state) redirect.searchParams.set("state", params.state);
  return res.redirect(302, redirect.toString());
};

function normalizeAuthorizeParams(input, req) {
  return {
    response_type: input.response_type || getQueryParam(req, "response_type"),
    client_id: input.client_id || getQueryParam(req, "client_id"),
    redirect_uri: input.redirect_uri || getQueryParam(req, "redirect_uri"),
    scope: input.scope || getQueryParam(req, "scope") || DEFAULT_SCOPES.join(" "),
    state: input.state || getQueryParam(req, "state"),
    code_challenge: input.code_challenge || getQueryParam(req, "code_challenge"),
    code_challenge_method: input.code_challenge_method || getQueryParam(req, "code_challenge_method") || "S256",
    resource: input.resource || getQueryParam(req, "resource"),
  };
}

function renderAuthorizePage(params, { pinRequired, pinError }) {
  const hidden = Object.entries(params)
    .map(([key, value]) => `<input type="hidden" name="${htmlEscape(key)}" value="${htmlEscape(value)}" />`)
    .join("\n");
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Authorize PaintAccess Operations</title>
    <style>
      body { font: 16px/1.45 system-ui, -apple-system, Segoe UI, Arial, sans-serif; margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f7f8f5; color: #17201a; }
      main { width: min(440px, calc(100vw - 32px)); background: #fff; border: 1px solid #d9e0d6; border-radius: 8px; padding: 24px; box-shadow: 0 18px 50px rgba(25,45,30,.12); }
      h1 { font-size: 22px; margin: 0 0 12px; }
      p { margin: 0 0 16px; color: #435044; }
      label { display: block; font-weight: 600; margin-bottom: 6px; }
      input[type=password] { box-sizing: border-box; width: 100%; padding: 10px 12px; border: 1px solid #aeb8ad; border-radius: 6px; font: inherit; }
      button { margin-top: 18px; width: 100%; border: 0; border-radius: 6px; padding: 12px 14px; background: #234d2b; color: #fff; font-weight: 700; cursor: pointer; }
      .error { color: #a42323; font-weight: 600; }
    </style>
  </head>
  <body>
    <main>
      <h1>Authorize PaintAccess Operations</h1>
      <p>This lets ChatGPT use the PaintAccess Operations MCP for Shopify, Gmail, and Drive tools configured in the backend.</p>
      ${pinError ? '<p class="error">The authorization PIN was not correct.</p>' : ""}
      <form method="post">
        ${hidden}
        <input type="hidden" name="approve" value="1" />
        ${pinRequired ? '<label for="pin">Authorization PIN</label><input id="pin" name="pin" type="password" autocomplete="one-time-code" autofocus />' : ""}
        <button type="submit">Authorize</button>
      </form>
    </main>
  </body>
</html>`;
}
