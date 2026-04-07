const crypto = require("crypto");

const SHOPIFY_APP_CLIENT_SECRET = (process.env.SHOPIFY_APP_CLIENT_SECRET || "").trim();

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
 * When accessed directly (no token), allows access if referer matches our domain
 * (owner/dev access). In production with token, full JWT verification is enforced.
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

  // No token — allow if no secret configured (dev) or if request comes from
  // our own domain (the iframe page making API calls to its own origin)
  if (!SHOPIFY_APP_CLIENT_SECRET) {
    return { dev: true };
  }

  // In production without token: check if it's the Shopify Admin loading us
  // App Bridge may not have initialized yet on first load, so allow the request
  // if the request origin looks legitimate
  const origin = req.headers.origin || "";
  const referer = req.headers.referer || "";
  if (
    origin.includes("admin.shopify.com") ||
    referer.includes("admin.shopify.com") ||
    origin.includes("ai-agent-front-back") ||
    referer.includes("ai-agent-front-back")
  ) {
    return { embedded: true };
  }

  res.status(401).json({ error: "Unauthorized" });
  return null;
}

module.exports = { verifySessionToken, requireDashboardAuth };
