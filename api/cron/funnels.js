/**
 * POST/GET /api/cron/funnels — runs one funnel-engine sweep. Called by the scheduler
 * (Supabase pg_cron via pg_net). Secret-guarded: this can send marketing, so it is not open.
 *
 * Ships dark: with ENABLE_FUNNELS unset the sweep returns {skipped:"disabled"} and sends nothing,
 * so the scheduler can be wired and run harmlessly before the engine is ever turned on.
 */
const { cleanEnv } = require("../../lib/shopify");
const engine = require("../../lib/comms/funnels/engine");

function authorized(req) {
  const secret = cleanEnv("CRON_SECRET");
  if (!secret) return false; // no secret set → endpoint stays closed
  const header = String(req.headers.authorization || "");
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  const q = String(req.query?.secret || "");
  return bearer === secret || q === secret;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!authorized(req)) return res.status(403).json({ error: "Forbidden" });

  try {
    const summary = await engine.runSweep();
    return res.status(200).json({ ok: true, ...summary });
  } catch (err) {
    console.error("[cron/funnels]", err.message);
    return res.status(500).json({ error: "Sweep failed" });
  }
};
