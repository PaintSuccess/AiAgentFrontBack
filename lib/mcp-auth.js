const crypto = require("crypto");
const { cleanEnv } = require("./shopify");

const DEFAULT_SCOPES = ["paintaccess.operations"];
// 90 days by default -- override with MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS /
// MCP_OAUTH_TOKEN_TTL_SECONDS if a longer-lived token is intentionally needed.
// This only affects OAuth-issued tokens (createAccessToken/createRefreshToken);
// the legacy SHOPIFY_MCP_TOKEN static bearer used by the current production
// ChatGPT connector has no TTL and is unaffected by this value.
const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60;
const DEFAULT_REFRESH_TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60;
const CODE_TTL_SECONDS = 10 * 60;

function parsePositiveIntEnv(name, fallback) {
  const raw = cleanEnv(name);
  const parsed = Number.parseInt(raw, 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return fallback;
}

function getAccessTokenTtlSeconds() {
  return parsePositiveIntEnv(
    "MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS",
    parsePositiveIntEnv("MCP_OAUTH_TOKEN_TTL_SECONDS", DEFAULT_ACCESS_TOKEN_TTL_SECONDS)
  );
}

function getRefreshTokenTtlSeconds() {
  return parsePositiveIntEnv("MCP_OAUTH_REFRESH_TOKEN_TTL_SECONDS", DEFAULT_REFRESH_TOKEN_TTL_SECONDS);
}

function getBaseUrl(req) {
  const configured = cleanEnv("PUBLIC_BASE_URL") || cleanEnv("APP_BASE_URL");
  if (configured) return configured.replace(/\/+$/, "");
  const host = req?.headers?.["x-forwarded-host"] || req?.headers?.host || cleanEnv("VERCEL_URL");
  const proto = req?.headers?.["x-forwarded-proto"] || "https";
  if (!host) return "https://ai-agent-front-back.vercel.app";
  const hostname = String(host).replace(/^https?:\/\//, "");
  return `${proto}://${hostname}`.replace(/\/+$/, "");
}

function getSecret() {
  const secret = cleanEnv("MCP_OAUTH_TOKEN_SECRET") || cleanEnv("SHOPIFY_MCP_TOKEN") || cleanEnv("API_SECRET_TOKEN");
  if (!secret) {
    const err = new Error("MCP OAuth secret is not configured.");
    err.statusCode = 500;
    throw err;
  }
  return secret;
}

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeBase64url(input) {
  const normalized = String(input || "").replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function signPayload(payload) {
  const encoded = base64url(JSON.stringify(payload));
  const signature = crypto.createHmac("sha256", getSecret()).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function verifySignedPayload(token, expectedType) {
  const [encoded, signature] = String(token || "").split(".");
  if (!encoded || !signature) return null;
  const expected = crypto.createHmac("sha256", getSecret()).update(encoded).digest("base64url");
  if (!safeEqual(signature, expected)) return null;

  let payload;
  try {
    payload = JSON.parse(decodeBase64url(encoded));
  } catch {
    return null;
  }

  if (expectedType && payload.type !== expectedType) return null;
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

function createAuthorizationCode(payload) {
  return signPayload({
    type: "authorization_code",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + CODE_TTL_SECONDS,
    ...payload,
  });
}

function createAccessToken(payload) {
  return signPayload({
    type: "access_token",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + getAccessTokenTtlSeconds(),
    scopes: DEFAULT_SCOPES,
    ...payload,
  });
}

function createRefreshToken(payload) {
  return signPayload({
    type: "refresh_token",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + getRefreshTokenTtlSeconds(),
    scopes: DEFAULT_SCOPES,
    ...payload,
  });
}

function verifyAccessToken(token) {
  return verifySignedPayload(token, "access_token");
}

function verifyRefreshToken(token) {
  return verifySignedPayload(token, "refresh_token");
}

function verifyPkce(verifier, challenge, method = "S256") {
  if (!challenge) return true;
  if (!verifier) return false;
  if (String(method).toUpperCase() === "S256") {
    const hashed = crypto.createHash("sha256").update(String(verifier)).digest("base64url");
    return safeEqual(hashed, challenge);
  }
  return safeEqual(verifier, challenge);
}

function getBearerToken(req) {
  return String(req?.headers?.authorization || "").replace(/^Bearer\s+/i, "").trim();
}

function verifyMcpRequest(req, requiredScopes = DEFAULT_SCOPES) {
  const expectedLegacyToken = cleanEnv("SHOPIFY_MCP_TOKEN");
  const allowUnauthenticated = cleanEnv("SHOPIFY_MCP_ALLOW_UNAUTHENTICATED") === "true";
  const isProduction = cleanEnv("VERCEL_ENV") === "production";
  // Never allow the unauthenticated escape hatch in production, regardless of how
  // SHOPIFY_MCP_ALLOW_UNAUTHENTICATED is set there -- it's meant for local/preview only.
  if (allowUnauthenticated && !expectedLegacyToken && !isProduction) {
    return { ok: true, mode: "unauthenticated" };
  }

  const bearer = getBearerToken(req);
  // NOTE: query-string token auth is the documented production mechanism for the
  // current live ChatGPT connector (see CLAUDE.md / shopify-operations-mcp-prd.md).
  // It's kept for compatibility; migrate the connector to header-only Bearer auth
  // (or full OAuth) when convenient, then remove this fallback -- URL-embedded
  // tokens can leak via logs/referrers/browser history.
  const queryToken = getQueryParam(req, "token");

  if (expectedLegacyToken) {
    const provided = bearer || queryToken;
    if (provided && safeEqual(provided, expectedLegacyToken)) {
      return { ok: true, mode: "legacy_token", scopes: DEFAULT_SCOPES };
    }
  }

  if (bearer) {
    const token = verifyAccessToken(bearer);
    if (token) {
      const scopes = Array.isArray(token.scopes)
        ? token.scopes
        : String(token.scope || "")
            .split(/\s+/)
            .filter(Boolean);
      const hasScopes = requiredScopes.every((scope) => scopes.includes(scope));
      return hasScopes
        ? { ok: true, mode: "oauth", token, scopes }
        : { ok: false, reason: "insufficient_scope" };
    }
  }

  return { ok: false, reason: "missing_or_invalid_token" };
}

function sendUnauthorized(req, res, reason = "invalid_token") {
  const baseUrl = getBaseUrl(req);
  res.setHeader(
    "WWW-Authenticate",
    `Bearer realm="PaintAccess Operations MCP", resource_metadata="${baseUrl}/.well-known/oauth-protected-resource", error="${reason}"`
  );
  return res.status(401).json({
    error: "Unauthorized",
    message: "Authorize the PaintAccess Operations app in ChatGPT or provide a valid MCP bearer token.",
  });
}

function protectedResourceMetadata(req) {
  const baseUrl = getBaseUrl(req);
  return {
    resource: `${baseUrl}/api/mcp/shopify`,
    authorization_servers: [`${baseUrl}/.well-known/oauth-authorization-server`],
    scopes_supported: DEFAULT_SCOPES,
    bearer_methods_supported: ["header"],
  };
}

function authorizationServerMetadata(req) {
  const baseUrl = getBaseUrl(req);
  return {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/api/oauth/authorize`,
    token_endpoint: `${baseUrl}/api/oauth/token`,
    registration_endpoint: `${baseUrl}/api/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256", "plain"],
    scopes_supported: DEFAULT_SCOPES,
  };
}

function isAllowedRedirectUri(value) {
  const uri = String(value || "");
  if (!uri) return false;
  const extra = cleanEnv("MCP_OAUTH_ALLOWED_REDIRECT_ORIGINS")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const allowedPrefixes = [
    "https://chatgpt.com/",
    "https://chat.openai.com/",
    "https://chatgpt.com",
    "https://chat.openai.com",
    ...extra,
  ];
  return allowedPrefixes.some((prefix) => uri.startsWith(prefix));
}

function getQueryParam(req, name) {
  try {
    const url = new URL(req.url || "", `https://${req.headers.host || "localhost"}`);
    return url.searchParams.get(name) || "";
  } catch {
    return "";
  }
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "object") return req.body;
  const body = String(req.body || "");
  try {
    return JSON.parse(body);
  } catch {
    return Object.fromEntries(new URLSearchParams(body));
  }
}

function htmlEscape(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

module.exports = {
  DEFAULT_SCOPES,
  DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
  DEFAULT_REFRESH_TOKEN_TTL_SECONDS,
  authorizationServerMetadata,
  createAccessToken,
  createAuthorizationCode,
  createRefreshToken,
  getAccessTokenTtlSeconds,
  getBaseUrl,
  getQueryParam,
  getRefreshTokenTtlSeconds,
  htmlEscape,
  isAllowedRedirectUri,
  parseBody,
  protectedResourceMetadata,
  safeEqual,
  sendUnauthorized,
  verifyAccessToken,
  verifyMcpRequest,
  verifyPkce,
  verifyRefreshToken,
  verifySignedPayload,
};
