/**
 * Idempotency for side-effecting ElevenLabs tool calls (send_sms_notification,
 * send_email_notification). See supabase/migrations/0009_tool_send_dedup.sql for the why.
 *
 * A retried tool call within TTL_SECONDS with the SAME recipient + body is treated as a
 * duplicate and NOT re-sent. A genuine identical re-request after the window proceeds
 * normally (the stale claim is swept first).
 *
 * Fail-OPEN everywhere: if Supabase is unavailable or errors, we return "send". A dedup
 * outage must never block a real customer message — a rare duplicate is the lesser harm.
 */
const crypto = require("crypto");
const { getSupabase } = require("./supabase");

// Long enough to cover an abandoned-call retry (seconds, occasionally a minute or two),
// short enough that a customer legitimately re-asking for the same thing isn't blocked.
const TTL_SECONDS = 180;

function dedupKey(kind, parts) {
  // JSON.stringify keeps the part boundaries unambiguous (so ["ab","c"] and ["a","bc"]
  // hash differently) without needing a separator byte in the input.
  const canonical = JSON.stringify((parts || []).map((p) => String(p == null ? "" : p)));
  const hash = crypto.createHash("sha256").update(canonical).digest("hex");
  return `${kind}:${hash}`;
}

/**
 * Claim a send. Returns "send" (you hold the claim — proceed) or "duplicate" (an identical
 * send happened within the window — skip and report success to the agent).
 * @param {string} kind    "sms" | "email"
 * @param {Array}  parts   content identity, e.g. [to, body]
 */
async function claimSend(kind, parts, { ttlSeconds = TTL_SECONDS } = {}) {
  const sb = getSupabase();
  if (!sb) return "send"; // no DB configured — never block a real send
  const key = dedupKey(kind, parts);
  try {
    // Self-cleaning: drop every claim older than the window (evaluated on the DB clock,
    // see sweep_tool_send_dedup). Keeps the table to roughly the last TTL of traffic AND
    // lets a genuine identical re-request proceed once its own earlier claim ages out.
    await sb.rpc("sweep_tool_send_dedup", { p_ttl_seconds: ttlSeconds });
    const { error } = await sb.from("tool_send_dedup").insert({ dedup_key: key, kind });
    if (!error) return "send";
    if (error.code === "23505") return "duplicate"; // a matching send is in flight / just happened
    console.error("[tool-dedup] claim insert failed, allowing send:", error.message);
    return "send"; // fail open on an unexpected DB error
  } catch (err) {
    console.error("[tool-dedup] claimSend threw, allowing send:", err.message);
    return "send";
  }
}

/**
 * Release a claim after the send FAILED, so a legitimate retry can try again instead of
 * being told "already sent". Only call this when NO side effect happened (a clean failure).
 */
async function releaseSend(kind, parts) {
  const sb = getSupabase();
  if (!sb) return;
  try {
    await sb.from("tool_send_dedup").delete().eq("dedup_key", dedupKey(kind, parts));
  } catch (err) {
    console.error("[tool-dedup] releaseSend failed:", err.message);
  }
}

module.exports = { claimSend, releaseSend, dedupKey, TTL_SECONDS };
