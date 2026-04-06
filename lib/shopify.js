const crypto = require("crypto");

const SHOPIFY_STORE = (process.env.SHOPIFY_STORE || "").trim();
const SHOPIFY_ACCESS_TOKEN = (process.env.SHOPIFY_ACCESS_TOKEN || "").trim();

// --- Rate Limiting (in-memory, per Vercel serverless instance) ---
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 30; // max requests per IP per minute

function rateLimit(req, res) {
  const ip =
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    "unknown";
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  // Cleanup stale entries periodically
  if (rateLimitMap.size > 5000) {
    for (const [key, val] of rateLimitMap) {
      if (now - val.start > RATE_LIMIT_WINDOW_MS) rateLimitMap.delete(key);
    }
  }

  if (!entry || now - entry.start > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(ip, { start: now, count: 1 });
    return false; // not limited
  }

  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    res.status(429).json({ error: "Too many requests. Please try again later." });
    return true; // limited
  }
  return false;
}

// --- CORS (restricted to allowed origins) ---
const ALLOWED_ORIGINS = [
  "https://paintaccess.com.au",
  "https://www.paintaccess.com.au",
  "https://zgmzge-0d.myshopify.com",
  "https://elevenlabs.io",
  "https://api.elevenlabs.io",
];

function corsHeaders(res, req) {
  const origin = req?.headers?.origin || "";
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  // Twilio webhooks and ElevenLabs server-side calls have no Origin header —
  // they're allowed through because they pass auth or signature verification.
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// --- Auth (timing-safe comparison) ---
function verifyAuth(req) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "").trim();
  const expected = (process.env.API_SECRET_TOKEN || "").trim();
  if (!token || !expected) return false;
  if (token.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

// --- Input sanitization ---
function sanitizeInput(str, maxLength = 200) {
  if (typeof str !== "string") return "";
  return str.slice(0, maxLength).replace(/[\x00-\x1f]/g, "").trim();
}

// --- Shopify REST ---
async function shopifyFetch(endpoint, options = {}) {
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
    throw new Error(`Shopify API ${res.status}: ${text}`);
  }

  return res.json();
}

// --- Shopify GraphQL ---
async function shopifyGraphQL(query, variables = {}) {
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
    throw new Error(`Shopify GraphQL ${res.status}: ${text}`);
  }

  const json = await res.json();
  if (json.errors) {
    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

module.exports = { shopifyFetch, shopifyGraphQL, verifyAuth, corsHeaders, rateLimit, sanitizeInput };
