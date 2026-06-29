const { cleanEnv } = require("../../lib/shopify");
const {
  createState,
  escapeHtml,
  getGoogleRedirectUri,
  getGoogleScopes,
  htmlPage,
  verifyAdminPin,
} = require("../../lib/google-oauth-admin");

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (req.method !== "GET") return res.status(405).send("Method not allowed");

  const clientId = cleanEnv("GOOGLE_CLIENT_ID");
  if (!clientId) {
    return res.status(500).send(
      htmlPage(
        "Google OAuth is not configured",
        `<h1>Google OAuth is not configured</h1>
        <p>Set <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> first.</p>`,
        "#b42318"
      )
    );
  }

  const pinCheck = verifyAdminPin(req);
  if (!pinCheck.ok) {
    return res.status(401).send(
      htmlPage(
        "Google OAuth admin PIN required",
        `<h1>Admin PIN required</h1>
        <p>Open this URL with <code>?pin=...</code> using <code>GOOGLE_OAUTH_ADMIN_PIN</code>.</p>
        <p class="muted">Example: <code>/api/google/oauth-start?pin=YOUR_PIN</code></p>`,
        "#b42318"
      )
    );
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getGoogleRedirectUri(req),
    response_type: "code",
    scope: getGoogleScopes(),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: createState({ mode: "google_workspace" }),
  });

  const loginHint = cleanEnv("GOOGLE_WORKSPACE_EMAIL");
  if (loginHint) params.set("login_hint", loginHint);

  res.redirect(302, `https://accounts.google.com/o/oauth2/v2/auth?${params}`);
};
