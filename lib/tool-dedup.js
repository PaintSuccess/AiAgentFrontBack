/**
 * Idempotency for side-effecting ElevenLabs tool calls (send_sms_notification,
 * send_email_notification). See supabase/migrations/0009_tool_send_dedup.sql and
 * 0010_tool_send_dedup_atomic_claim.sql for the why and the schema.
 *
 * A retried tool call within TTL_SECONDS with the SAME recipient + body is treated as a
 * duplicate and NOT re-sent. A genuine identical re-request after the window proceeds
 * normally (a stale claim is atomically reclaimed inline — see claim_tool_send_dedup()).
 *
 * Fail-OPEN everywhere: if Supabase is unavailable or errors, we return "send". A dedup
 * outage must never block a real customer message — a rare duplicate is the lesser harm.
 *
 * The claim/release contract callers MUST follow (Codex review of the first version,
 * 2026-07-22, caught this): only release a claim when the send is CONFIRMED not to have
 * happened (e.g. a definitive HTTP rejection from the provider before any message was
 * queued). On an AMBIGUOUS failure — a raw network exception where the provider may have
 * already processed the request before the connection dropped — do NOT release. Leaving
 * the claim in place blocks a resend for up to the TTL, which is a far better outcome than
 * risking an actual duplicate SMS or email. Callers can tell the two apart because both
 * lib/shopify.js's shopifyFetch and this file's sendTwilioSms attach `err.statusCode` only
 * when the provider actually returned a response; a raw fetch()-level exception has none.
 *
 * Known accepted limitation (also from that review): two TRULY concurrent claims for the
 * same content can race so that the loser is told "duplicate" (implying success) a moment
 * before the winner's send actually resolves — if the winner then hits a confirmed failure
 * and releases, the loser's earlier answer was optimistic. This is deliberately not solved
 * with a wait-and-recheck here: that would add real latency (bounded polling) to EVERY
 * duplicate hit, including the overwhelmingly common case (a sequential retry seconds
 * later, where the row's state is already settled) — regressing the exact speed problem
 * this feature exists to fix, to guard a narrow window that ElevenLabs' own sequential
 * per-conversation tool-calling makes rare in practice.
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
    // Single atomic round trip: the SQL function does the staleness check AND the
    // claim/reclaim inside one statement, evaluated entirely on the DB clock. Unlike the
    // first version of this file, correctness here does NOT depend on a separate sweep
    // having run — a stale row is self-healed on the very claim attempt that finds it.
    const { data, error } = await sb.rpc("claim_tool_send_dedup", {
      p_key: key,
      p_kind: kind,
      p_ttl_seconds: ttlSeconds,
    });
    if (error) {
      console.error("[tool-dedup] claim rpc failed, allowing send:", error.message);
      return "send"; // fail open on an unexpected DB error
    }
    return data === "claimed" ? "send" : "duplicate";
  } catch (err) {
    console.error("[tool-dedup] claimSend threw, allowing send:", err.message);
    return "send";
  }
}

/**
 * Release a claim after the send is CONFIRMED not to have happened (see the contract note
 * at the top of this file) — so a legitimate retry can proceed immediately instead of
 * waiting out the TTL. Never call this after an ambiguous (no-statusCode) failure.
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
