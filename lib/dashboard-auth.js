const crypto = require("crypto");
const { cleanEnv } = require("./shopify");

const SHOPIFY_APP_CLIENT_SECRET = cleanEnv("SHOPIFY_APP_CLIENT_SECRET");

/**
 * Verify a Shopify App Bridge session token (JWT).
 * Returns the decoded payload if valid, or null.
 */
function verifySessionToken(token) {
  if (!token || !SHOPIFY_APP_CLIENT_SECRET) return null;

  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    if (header.alg !== "HS256") return null;

    // Verify signature
    const signatureInput = `${parts[0]}.${parts[1]}`;
    const expectedSig = crypto
      .createHmac("sha256", SHOPIFY_APP_CLIENT_SECRET)
      .update(signatureInput)
      .digest("base64url");

    // Timing-safe comparison
    if (expectedSig.length !== parts[2].length) return null;
    const valid = crypto.timingSafeEqual(
      Buffer.from(expectedSig),
      Buffer.from(parts[2])
    );
    if (!valid) return null;

    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());

    // Check expiry (allow 10s clock skew)
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp + 10 < now) return null;
    if (payload.nbf && payload.nbf - 10 > now) return null;

    return payload;
  } catch (e) {
    console.error("Session token verification failed:", e.message);
    return null;
  }
}

/**
 * Middleware: verify session token from Authorization header.
 * Returns decoded payload or sends 401 and returns null.
 *
 * When running inside Shopify Admin iframe, App Bridge provides a signed JWT.
 * Production dashboard APIs must not rely on Origin/Referer because those are
 * request metadata, not authentication. Local/dev bypass is only available when
 * no app secret is configured or DASHBOARD_DEV_BYPASS=true is set explicitly.
 */
function requireDashboardAuth(req, res) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "").trim();

  // If a token is provided, verify it strictly
  if (token && SHOPIFY_APP_CLIENT_SECRET) {
    const payload = verifySessionToken(token);
    if (!payload) {
      res.status(401).json({ error: "Invalid session token" });
      return null;
    }
    return payload;
  }

  // No token: allow only explicit local/dev bypass.
  if (!SHOPIFY_APP_CLIENT_SECRET || cleanEnv("DASHBOARD_DEV_BYPASS") === "true") {
    return { dev: true };
  }

  res.status(401).json({ error: "Unauthorized" });
  return null;
}

module.exports = { verifySessionToken, requireDashboardAuth };
