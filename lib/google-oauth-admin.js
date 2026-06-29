const crypto = require("crypto");
const { cleanEnv } = require("./shopify");
const { triggerDeployHook, upsertVercelEnv } = require("./vercel-env");

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const DEFAULT_GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.file",
].join(" ");

function getBaseUrl(req) {
  return (
    cleanEnv("PUBLIC_BASE_URL") ||
    cleanEnv("BACKEND_URL") ||
    `https://${req.headers["x-forwarded-host"] || req.headers.host}`
  ).replace(/\/+$/, "");
}

function getGoogleRedirectUri(req) {
  return cleanEnv("GOOGLE_OAUTH_REDIRECT_URI") || `${getBaseUrl(req)}/api/google/oauth-callback`;
}

function getGoogleScopes() {
  return cleanEnv("GOOGLE_OAUTH_SCOPES") || DEFAULT_GOOGLE_SCOPES;
}

function getStateSecret() {
  return (
    cleanEnv("GOOGLE_OAUTH_STATE_SECRET") ||
    cleanEnv("MCP_OAUTH_TOKEN_SECRET") ||
    cleanEnv("API_SECRET_TOKEN") ||
    cleanEnv("SHOPIFY_MCP_TOKEN")
  );
}

function createState(extra = {}) {
  const secret = getStateSecret();
  if (!secret) {
    const err = new Error("GOOGLE_OAUTH_STATE_SECRET or another backend secret is required.");
    err.statusCode = 500;
    throw err;
  }
  const payload = Buffer.from(
    JSON.stringify({
      nonce: crypto.randomBytes(16).toString("hex"),
      ts: Date.now(),
      ...extra,
    })
  ).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function verifyState(state) {
  const secret = getStateSecret();
  if (!secret) return { ok: false, reason: "state_secret_missing" };
  const [payload, sig] = String(state || "").split(".");
  if (!payload || !sig) return { ok: false, reason: "invalid_state" };
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return { ok: false, reason: "state_signature_mismatch" };
  }
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch (err) {
    return { ok: false, reason: "state_parse_failed" };
  }
  if (!data.ts || Date.now() - data.ts > 15 * 60 * 1000) {
    return { ok: false, reason: "state_expired" };
  }
  return { ok: true, data };
}

function verifyAdminPin(req) {
  const configuredPin = cleanEnv("GOOGLE_OAUTH_ADMIN_PIN") || cleanEnv("MCP_OAUTH_PIN");
  if (!configuredPin) return { ok: true, mode: "not_configured" };
  const supplied = String(req.query.pin || req.query.admin_pin || "").trim();
  if (supplied && safeCompare(supplied, configuredPin)) return { ok: true, mode: "pin" };
  return { ok: false, reason: "invalid_pin" };
}

function safeCompare(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

async function exchangeGoogleCode({ code, req }) {
  const clientId = cleanEnv("GOOGLE_CLIENT_ID");
  const clientSecret = cleanEnv("GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    const err = new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required.");
    err.statusCode = 500;
    throw err;
  }

  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: getGoogleRedirectUri(req),
    grant_type: "authorization_code",
  });

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error_description || json.error || "Google token exchange failed.");
    err.statusCode = res.status;
    err.google = json;
    throw err;
  }
  return json;
}

function htmlPage(title, body, statusColor = "#116329") {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; max-width: 820px; margin: 40px auto; padding: 0 20px; line-height: 1.5; color: #202124; }
    h1 { color: ${statusColor}; }
    code, textarea { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
    textarea { width: 100%; min-height: 120px; }
    .card { border: 1px solid #d0d7de; border-radius: 8px; padding: 16px; margin: 16px 0; }
    .warn { color: #9a3412; }
    .muted { color: #5f6368; }
  </style>
</head>
<body>${body}</body>
</html>`;
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

module.exports = {
  DEFAULT_GOOGLE_SCOPES,
  createState,
  escapeHtml,
  exchangeGoogleCode,
  getGoogleRedirectUri,
  getGoogleScopes,
  htmlPage,
  triggerDeployHook,
  upsertVercelEnv,
  verifyAdminPin,
  verifyState,
};
