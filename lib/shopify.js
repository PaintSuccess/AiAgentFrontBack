// Defensive: env values pasted into Vercel sometimes carry trailing
// newlines / whitespace (\r\n). That silently corrupts URLs and auth
// headers and is hard to spot. cleanEnv strips ALL surrounding
// whitespace and any literal "\r"/"\n" escape sequences that may have
// been written into the value, and rejects control characters which
// can never be valid in our env vars.
function cleanEnv(name) {
  const raw = process.env[name];
  if (raw == null) return "";
  return String(raw)
    .replace(/\\[rn]/g, "") // literal backslash-r / backslash-n in pasted values
    .replace(/[\r\n\t\v\f]+/g, "") // real control whitespace
    .trim();
}

const SHOPIFY_STORE = cleanEnv("SHOPIFY_STORE");
const SHOPIFY_ACCESS_TOKEN = cleanEnv("SHOPIFY_ACCESS_TOKEN");
const API_SECRET_TOKEN = cleanEnv("API_SECRET_TOKEN");

async function shopifyFetch(endpoint, options = {}) {
  if (!SHOPIFY_STORE || !SHOPIFY_ACCESS_TOKEN) {
    const err = new Error(
      "Shopify credentials are not configured (SHOPIFY_STORE / SHOPIFY_ACCESS_TOKEN)."
    );
    err.statusCode = 500;
    throw err;
  }
  const url = `https://${SHOPIFY_STORE}/admin/api/2024-10/${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Shopify API ${res.status}: ${text}`);
    err.statusCode = res.status;
    err.upstream = text;
    throw err;
  }

  return res.json();
}

// GraphQL Admin API caller. REST `title=` is exact-match only — for
// substring/keyword search across thousands of products you MUST use
// GraphQL with the `query:` argument, which mirrors Shopify admin search
// syntax (free text, plus filters like `sku:`, `vendor:`, `tag:`).
async function shopifyGraphQL(query, variables = {}) {
  if (!SHOPIFY_STORE || !SHOPIFY_ACCESS_TOKEN) {
    const err = new Error(
      "Shopify credentials are not configured (SHOPIFY_STORE / SHOPIFY_ACCESS_TOKEN)."
    );
    err.statusCode = 500;
    throw err;
  }
  const url = `https://${SHOPIFY_STORE}/admin/api/2024-10/graphql.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Shopify GraphQL ${res.status}: ${text}`);
    err.statusCode = res.status;
    throw err;
  }
  const json = await res.json();
  if (json.errors && json.errors.length) {
    const err = new Error(
      `Shopify GraphQL errors: ${JSON.stringify(json.errors)}`
    );
    err.statusCode = 500;
    throw err;
  }
  return json.data;
}

function verifyAuth(req) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "").trim();
  if (!API_SECRET_TOKEN || token !== API_SECRET_TOKEN) {
    return false;
  }
  return true;
}

function corsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// Sanitize user-supplied strings: strip characters that could be used for
// injection attacks, trim whitespace, and cap length.
function sanitizeInput(str, maxLength = 200) {
  if (str == null) return "";
  return String(str)
    .replace(/[<>'"`;\\]/g, "")
    .trim()
    .slice(0, maxLength);
}

// Simple in-memory rate limiter keyed by client IP.
// Returns true (and sends 429) when the caller is over the limit.
const _rlMap = new Map();
const RL_MAX = 60; // requests
const RL_WINDOW = 60 * 1000; // per 60 seconds

function rateLimit(req, res) {
  const ip =
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    "unknown";
  const now = Date.now();
  const entry = _rlMap.get(ip);
  if (!entry || now - entry.t > RL_WINDOW) {
    _rlMap.set(ip, { t: now, n: 1 });
    return false;
  }
  entry.n += 1;
  if (entry.n > RL_MAX) {
    res.status(429).json({ error: "Too many requests, please try again later." });
    return true;
  }
  return false;
}

module.exports = {
  shopifyFetch,
  shopifyGraphQL,
  verifyAuth,
  corsHeaders,
  sanitizeInput,
  rateLimit,
  cleanEnv,
};
