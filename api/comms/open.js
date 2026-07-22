/**
 * GET /api/comms/open?t=<threadId> — short admin deep link used in staff handoff
 * alerts ("/t/<id>" rewrites here, see vercel.json). 302s into the embedded app
 * in Shopify admin with the thread preselected (App.jsx reads ?thread= on boot).
 *
 * Deliberately unauthenticated: it only redirects to Shopify admin, which
 * enforces its own login — the URL reveals nothing but an opaque thread id, and
 * the redirect target is a fixed env-configured base (no open-redirect surface).
 */
const { corsHeaders, rateLimit, cleanEnv } = require("../../lib/shopify");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = async function handler(req, res) {
  corsHeaders(res, req);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (await rateLimit(req, res)) return;
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const t = String(req.query?.t || "").trim();
  const base = cleanEnv("ADMIN_DEEP_LINK_BASE").replace(/\/$/, "");
  if (!base || !UUID_RE.test(t)) {
    return res.status(404).send("Not found");
  }

  const sep = base.includes("?") ? "&" : "?";
  res.setHeader("Location", `${base}${sep}page=inbox&thread=${encodeURIComponent(t)}`);
  return res.status(302).end();
};
