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

// Rate limiter shared by every endpoint. Backed by Upstash Redis (durable,
// shared across all serverless instances) when configured. Falls back to the
// old in-memory Map (per-instance, resets on cold start -- known-weaker, but
// keeps local dev / previews without Redis configured working exactly as
// before) so this never hard-fails when the env vars are absent.
// Accepts either naming convention: UPSTASH_REDIS_REST_URL/TOKEN (a directly
// provisioned Upstash account) or KV_REST_API_URL/TOKEN (the names Vercel's
// own Upstash-for-Redis marketplace integration creates automatically) --
// same underlying Upstash REST API either way.
const UPSTASH_URL = cleanEnv("UPSTASH_REDIS_REST_URL") || cleanEnv("KV_REST_API_URL");
const UPSTASH_TOKEN = cleanEnv("UPSTASH_REDIS_REST_TOKEN") || cleanEnv("KV_REST_API_TOKEN");

let _ratelimiters = null; // lazily built map of "max:windowSec" -> Ratelimit instance
function _getUpstashLimiter(max, windowSeconds) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null;
  if (!_ratelimiters) {
    const { Redis } = require("@upstash/redis");
    const { Ratelimit } = require("@upstash/ratelimit");
    _ratelimiters = { redis: new Redis({ url: UPSTASH_URL, token: UPSTASH_TOKEN }), cache: new Map() };
  }
  const key = `${max}:${windowSeconds}`;
  let limiter = _ratelimiters.cache.get(key);
  if (!limiter) {
    const { Ratelimit } = require("@upstash/ratelimit");
    limiter = new Ratelimit({
      redis: _ratelimiters.redis,
      limiter: Ratelimit.slidingWindow(max, `${windowSeconds} s`),
      prefix: "pa_rl",
    });
    _ratelimiters.cache.set(key, limiter);
  }
  return limiter;
}

// In-memory fallback (same behavior as the original implementation).
const _rlMap = new Map();
function _inMemoryLimited(key, max, windowMs) {
  const now = Date.now();
  const entry = _rlMap.get(key);
  if (!entry || now - entry.t > windowMs) {
    _rlMap.set(key, { t: now, n: 1 });
    return false;
  }
  entry.n += 1;
  return entry.n > max;
}

// Generic keyed rate check other endpoints (e.g. SMS per-phone limits) can
// reuse instead of keeping their own in-memory counters. Returns true when
// the caller is over the limit for this key.
async function checkRateLimit(key, max, windowSeconds) {
  const upstash = _getUpstashLimiter(max, windowSeconds);
  if (upstash) {
    try {
      const { success } = await upstash.limit(key);
      return !success;
    } catch (err) {
      console.error("[rateLimit] Upstash error, falling back to in-memory:", err?.message || err);
      return _inMemoryLimited(key, max, windowSeconds * 1000);
    }
  }
  return _inMemoryLimited(key, max, windowSeconds * 1000);
}

const RL_MAX = 60; // requests
const RL_WINDOW_SECONDS = 60; // per 60 seconds

// Returns true (and sends 429) when the caller is over the limit.
async function rateLimit(req, res) {
  const ip =
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    "unknown";
  const limited = await checkRateLimit(`ip:${ip}`, RL_MAX, RL_WINDOW_SECONDS);
  if (limited) {
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
  checkRateLimit,
  cleanEnv,
};
