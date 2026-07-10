/**
 * Supabase service-role client (backend only).
 *
 * Uses the service-role key, which bypasses RLS — never expose this client or key
 * to the browser. The frontend talks to our own /api/* endpoints, not Supabase
 * directly. Returns null when Supabase env is not configured so callers can no-op
 * safely (comms logging must never break the live message flow).
 */
const { createClient } = require("@supabase/supabase-js");
const { cleanEnv } = require("./shopify");

let cached;

function getSupabase() {
  if (cached !== undefined) return cached;

  const url = cleanEnv("SUPABASE_URL");
  const key = cleanEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    cached = null;
    return cached;
  }

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-application-name": "paintaccess-comms" } },
  });
  return cached;
}

module.exports = { getSupabase };
