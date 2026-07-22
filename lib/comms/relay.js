/**
 * Relay handoff (Option 3, PLAN-HumanHandoff.md) — mirrors a customer's thread to
 * staff phones (WhatsApp first, SMS fallback) and routes staff replies back to the
 * customer through the business number. The customer never leaves the chat they
 * are already in; staff work from their own phones; every message is logged in
 * the Comms Hub because it all flows through our number.
 *
 * Layering rule: handoff.js requires this module — this module must NEVER require
 * handoff.js (CommonJS cycle), so the staff-number env parsing is duplicated here.
 *
 * Staff mirrors are sent via the RAW senders (sendWhatsAppMessage / twilioSendSms),
 * not send.js's sendMessage — sendMessage logs to the comms spine, which would
 * create contact/thread rows for staff numbers and pollute the inbox. Customer-bound
 * staff replies DO use sendMessage on purpose: they belong in the customer thread.
 *
 * Every public function is fail-safe (returns null / false on error) — a relay bug
 * or a missing table (migration 0008 not applied yet) must never break an inbound
 * webhook or an escalation.
 */
const { cleanEnv } = require("../shopify");
const { getSupabase } = require("../supabase");
const { normalizeE164, sendWhatsAppMessage } = require("./../whatsapp");
const { sendMessage, twilioSendSms } = require("./send");
const store = require("./store");
const queries = require("./queries");

const MIRROR_MAX_CHARS = 1200;

function relayEnabled() {
  return cleanEnv("HANDOFF_METHOD").trim().toLowerCase() === "relay";
}

function idleLimitMs() {
  const hours = Number(cleanEnv("RELAY_IDLE_HOURS")) || 48;
  return hours * 3600 * 1000;
}

/** Staff phones from HUMAN_SUPPORT_NOTIFY_NUMBERS (same env handoff.js pages). */
function staffPhones() {
  return cleanEnv("HUMAN_SUPPORT_NOTIFY_NUMBERS")
    .split(",")
    .map((s) => normalizeE164(s.trim()))
    .filter(Boolean);
}

/**
 * Optional display names for cross-mirrors, e.g.
 * HANDOFF_STAFF_NAMES="+61410609617:Daniel,+61400000000:Cris".
 * Unknown numbers fall back to the last 4 digits.
 */
function staffLabel(phone) {
  const e164 = normalizeE164(phone);
  for (const pair of cleanEnv("HANDOFF_STAFF_NAMES").split(",")) {
    const [num, name] = pair.split(":").map((s) => (s || "").trim());
    if (name && normalizeE164(num) === e164) return name;
  }
  return e164 ? `staff ..${e164.slice(-4)}` : "staff";
}

/**
 * Short admin deep link into the Comms Hub thread ("/t/<id>" → api/comms/open →
 * Shopify admin). Requires ADMIN_DEEP_LINK_BASE (the redirect target) to be set —
 * without it the short link would 404, so we omit it entirely.
 */
function adminThreadLink(threadId) {
  if (!threadId) return null;
  if (!cleanEnv("ADMIN_DEEP_LINK_BASE")) return null;
  const base = (cleanEnv("PUBLIC_BASE_URL") || cleanEnv("BACKEND_URL") || "").replace(/\/$/, "");
  return base ? `${base}/t/${threadId}` : null;
}

function firstName(name) {
  const n = String(name || "").trim();
  return n ? n.split(/\s+/)[0].slice(0, 30) : "";
}

/** Escalation channel → which channel the customer leg runs on. Voice callers and
 *  widget users with a phone are reached by SMS (always deliverable, no 24h window);
 *  a customer already on WhatsApp stays on WhatsApp. */
function customerChannelFor(channel) {
  return String(channel || "").toLowerCase() === "whatsapp" ? "whatsapp" : "sms";
}

/**
 * Staff commands. Pure — offline-tested in scripts/test-handoff-relay.js.
 *   "#done" / "#close" (optional tag)  → close a relay
 *   "#link" (optional tag)             → resend the admin link
 *   "#12 message text"                 → message addressed to relay #12
 *   anything else                      → plain message (needs quote / single active)
 */
function parseStaffCommand(text) {
  const t = String(text || "").trim();
  let m = t.match(/^#(?:done|close)(?:\s+#?(\d+))?\s*$/i);
  if (m) return { type: "done", tag: m[1] ? Number(m[1]) : null };
  m = t.match(/^#link(?:\s+#?(\d+))?\s*$/i);
  if (m) return { type: "link", tag: m[1] ? Number(m[1]) : null };
  m = t.match(/^#(\d+)\s+([\s\S]+)$/);
  if (m) return { type: "message", tag: Number(m[1]), body: m[2].trim() };
  return { type: "message", tag: null, body: t };
}

/**
 * Pick the relay a staff action targets. Pure. Precedence: explicit #tag →
 * quote-reply (relayId resolved from the mirror map by the caller) → the only
 * active relay. Never guesses between several.
 */
function resolveTarget({ tag, quotedRelayId, relays }) {
  const list = relays || [];
  if (tag != null) {
    const hit = list.find((r) => Number(r.tag) === Number(tag));
    return hit ? { relay: hit } : { error: "unknown_tag" };
  }
  if (quotedRelayId) {
    const hit = list.find((r) => r.id === quotedRelayId);
    if (hit) return { relay: hit };
    // Quoted an old mirror of a session that has since closed.
    return { error: "closed" };
  }
  if (list.length === 1) return { relay: list[0] };
  if (list.length === 0) return { error: "none" };
  return { error: "ambiguous" };
}

function describeRelay(r) {
  const who = [r.customer_name, r.customer_phone].filter(Boolean).join(" ") || "customer";
  return `#${r.tag} ${who}${r.reason ? ` — ${String(r.reason).slice(0, 60)}` : ""}`;
}

// ---------------------------------------------------------------------------
// DB access (all fail-safe)
// ---------------------------------------------------------------------------

async function getActiveRelayByThread(threadId) {
  try {
    const sb = getSupabase();
    if (!sb || !threadId) return null;
    const { data } = await sb
      .from("handoff_relays")
      .select("*")
      .eq("thread_id", threadId)
      .eq("status", "active")
      .maybeSingle();
    return data || null;
  } catch (err) {
    console.error("[relay] getActiveRelayByThread failed:", err.message);
    return null;
  }
}

async function listActiveRelays() {
  try {
    const sb = getSupabase();
    if (!sb) return [];
    const { data } = await sb
      .from("handoff_relays")
      .select("*")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(20);
    return data || [];
  } catch (err) {
    console.error("[relay] listActiveRelays failed:", err.message);
    return [];
  }
}

async function relayByMirrorSid(messageSid) {
  try {
    const sb = getSupabase();
    if (!sb || !messageSid) return null;
    const { data } = await sb
      .from("handoff_relay_mirrors")
      .select("relay_id")
      .eq("kind", "mirror")
      .eq("message_sid", messageSid)
      .maybeSingle();
    return data?.relay_id || null;
  } catch (err) {
    console.error("[relay] relayByMirrorSid failed:", err.message);
    return null;
  }
}

/** True if a ledger row of this kind exists for this provider SID. Used as the
 *  cheap pre-check for customer mirrors (at-least-once is acceptable there);
 *  customer-bound sends must use claimLedger instead. */
async function ledgerHas(kind, messageSid) {
  if (!messageSid) return false;
  try {
    const sb = getSupabase();
    if (!sb) return false;
    const { data, error } = await sb
      .from("handoff_relay_mirrors")
      .select("id")
      .eq("kind", kind)
      .eq("message_sid", messageSid)
      .limit(1);
    if (error) throw error;
    return Boolean(data && data.length);
  } catch (err) {
    console.error("[relay] ledgerHas failed:", err.message);
    return false;
  }
}

/**
 * Atomically claim a SID for exactly-once work. The partial unique index on
 * (kind, message_sid) makes concurrent webhook retries race here, and only ONE
 * caller wins — the loser sees the 23505 conflict and must not send.
 * @returns {"claimed"|"duplicate"|"error"} — "error" means the DB couldn't
 *          confirm the claim; customer-bound sends must NOT proceed (fail closed).
 */
async function claimLedger(relayId, kind, messageSid, staffPhone = null) {
  if (!relayId || !messageSid) return "claimed"; // nothing to key on — behave as before
  try {
    const sb = getSupabase();
    if (!sb) return "error";
    const { error } = await sb
      .from("handoff_relay_mirrors")
      .insert({ relay_id: relayId, kind, message_sid: messageSid, staff_phone: staffPhone });
    if (!error) return "claimed";
    if (error.code === "23505") return "duplicate";
    console.error("[relay] claimLedger insert failed:", error.message);
    return "error";
  } catch (err) {
    console.error("[relay] claimLedger failed:", err.message);
    return "error";
  }
}

async function recordLedger(relayId, kind, messageSid, staffPhone = null) {
  if (!relayId || !messageSid) return;
  try {
    const sb = getSupabase();
    if (!sb) return;
    await sb
      .from("handoff_relay_mirrors")
      .insert({ relay_id: relayId, kind, message_sid: messageSid, staff_phone: staffPhone });
  } catch (err) {
    console.error("[relay] recordLedger failed:", err.message);
  }
}

/** The relay whose mirror this staff phone received most recently — a proxy for
 *  "what conversation is on their screen". Used to refuse routing an untagged,
 *  unquoted reply when their context doesn't match the active relay. */
async function lastMirrorRelayForStaff(staffPhone) {
  try {
    const sb = getSupabase();
    if (!sb || !staffPhone) return null;
    const { data } = await sb
      .from("handoff_relay_mirrors")
      .select("relay_id")
      .eq("kind", "mirror")
      .eq("staff_phone", staffPhone)
      .order("created_at", { ascending: false })
      .limit(1);
    return data?.[0]?.relay_id || null;
  } catch (err) {
    console.error("[relay] lastMirrorRelayForStaff failed:", err.message);
    return null;
  }
}

async function patchRelay(id, patch) {
  try {
    const sb = getSupabase();
    if (!sb || !id) return;
    await sb.from("handoff_relays").update(patch).eq("id", id);
  } catch (err) {
    console.error("[relay] patchRelay failed:", err.message);
  }
}

async function recordMirrors(relayId, sends) {
  try {
    const sb = getSupabase();
    if (!sb || !relayId) return;
    const rows = (sends || [])
      .filter((s) => s && s.sid)
      .map((s) => ({ relay_id: relayId, kind: "mirror", message_sid: s.sid, staff_phone: s.phone }));
    if (rows.length) await sb.from("handoff_relay_mirrors").insert(rows);
  } catch (err) {
    console.error("[relay] recordMirrors failed:", err.message);
  }
}

/** Close relays idle past RELAY_IDLE_HOURS and hand their threads back to the AI.
 *  Called lazily from the traffic paths — no cron needed (same pattern as
 *  queries.sweepExpiredControl). */
async function lazyCloseIdle() {
  try {
    const sb = getSupabase();
    if (!sb) return;
    const cutoff = new Date(Date.now() - idleLimitMs()).toISOString();
    const { data } = await sb
      .from("handoff_relays")
      .update({ status: "closed", closed_at: new Date().toISOString() })
      .eq("status", "active")
      .lt("last_activity_at", cutoff)
      .select("id, thread_id, tag");
    for (const r of data || []) {
      await queries.setControl(r.thread_id, "ai").catch(() => {});
      console.log(`[relay] auto-closed idle relay #${r.tag}`);
    }
  } catch (err) {
    console.error("[relay] lazyCloseIdle failed:", err.message);
  }
}

// ---------------------------------------------------------------------------
// Sending to staff (raw senders — never the logged sendMessage path)
// ---------------------------------------------------------------------------

/** WhatsApp first; SMS fallback (covers a closed 24h window or a WA-less staff
 *  phone). Returns {sid, phone, channel} or null — never throws. */
async function sendToStaffLeg(phone, body) {
  try {
    const sent = await sendWhatsAppMessage({ to: phone, body });
    return { sid: sent?.id || "", phone, channel: "whatsapp" };
  } catch (waErr) {
    try {
      const sent = await twilioSendSms({ to: phone, body });
      return { sid: sent?.id || "", phone, channel: "sms" };
    } catch (smsErr) {
      console.error(`[relay] staff leg ${phone} unreachable: wa=${waErr.message} sms=${smsErr.message}`);
      return null;
    }
  }
}

async function broadcastToStaff(body, { except = null } = {}) {
  const legs = staffPhones().filter((p) => p !== normalizeE164(except));
  const results = await Promise.all(legs.map((p) => sendToStaffLeg(p, body)));
  return results.filter(Boolean);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Open a relay session for a thread and alert the staff legs.
 * @returns {Promise<{relay, notified: number}|null>} null = relay could not open
 *          (caller must fall back to the deep-link handoff — never fail an escalation).
 */
async function openRelay({ threadId, phone, name, email, channel, reason, openedBy = "escalation" }) {
  try {
    const sb = getSupabase();
    if (!sb || !threadId) return null;
    await lazyCloseIdle();

    let created = false;
    let relay = await getActiveRelayByThread(threadId);
    if (!relay) {
      const { data, error } = await sb
        .from("handoff_relays")
        .insert({
          thread_id: threadId,
          customer_phone: normalizeE164(phone) || null,
          customer_name: String(name || "").slice(0, 100) || null,
          customer_channel: customerChannelFor(channel),
          reason: String(reason || "").slice(0, 300) || null,
          opened_by: openedBy,
        })
        .select("*")
        .maybeSingle();
      // A concurrent escalation on the same thread trips the partial unique index —
      // that racer's row is the session; reuse it (and let the racer send the alert,
      // so staff aren't paged twice for one relay).
      created = Boolean(data);
      relay = data || (error ? await getActiveRelayByThread(threadId) : null);
      if (!relay) {
        if (error) console.error("[relay] openRelay insert failed:", error.message);
        return null;
      }
    }

    // Re-escalation on an already-open relay whose alert DID go out: don't page
    // staff again, just report the session as live. If alerted_at is missing, the
    // inserting invocation died before broadcasting — fall through and send the
    // alert now (this call becomes the alerting path).
    if (!created && relay.alerted_at) {
      return { relay, notified: staffPhones().length };
    }

    // Recent context for the alert (best-effort).
    let recent = [];
    try {
      const { data: msgs } = await sb
        .from("messages")
        .select("direction, body")
        .eq("thread_id", threadId)
        .order("sent_at", { ascending: false })
        .limit(3);
      recent = (msgs || [])
        .filter((m) => m.direction === "inbound" && m.body)
        .reverse()
        .map((m) => `› ${String(m.body).slice(0, 140)}`);
    } catch { /* alert still goes out without context */ }

    const who = [relay.customer_name, relay.customer_phone, email].filter(Boolean).join(" · ") || "unknown customer";
    const link = adminThreadLink(threadId);
    const alert = [
      `🆘 Handoff #${relay.tag} — ${who}`,
      `Channel: ${channel || "unknown"}${reason ? ` · Reason: ${reason}` : ""}`,
      recent.length ? recent.join("\n") : null,
      `↩️ Quote this message (or start with #${relay.tag}) to reply to the customer`,
      link ? `📋 Admin: ${link}` : null,
      `Send "#done ${relay.tag}" when finished`,
    ].filter(Boolean).join("\n");

    const sends = await broadcastToStaff(alert);
    if (!sends.length) {
      // Nobody was reached (empty staff env, or every WA+SMS leg failed). A relay
      // with no staff is a silent black hole for the customer — close it and make
      // the caller fall back to the deep-link handoff instead.
      await patchRelay(relay.id, { status: "closed", closed_at: new Date().toISOString() });
      console.error("[relay] openRelay reached 0 staff — closing relay, caller must fall back.");
      return null;
    }
    await patchRelay(relay.id, { alerted_at: new Date().toISOString() });
    await recordMirrors(relay.id, sends);
    await queries.humanTakeoverThread(threadId).catch(() => {});

    // Outcome marker in the thread — the inbox is where someone works out later
    // why nobody replied, so it records how many staff were actually reached.
    await store
      .recordOutbound({
        channel: relay.customer_channel,
        toPhone: relay.customer_phone,
        author: "system",
        body: `⚑ Relay #${relay.tag} open — staff alerted ${sends.length}/${staffPhones().length}. AI paused.`,
        status: "sent",
      })
      .catch(() => {});

    return { relay, notified: sends.length };
  } catch (err) {
    console.error("[relay] openRelay failed:", err.message);
    return null;
  }
}

async function closeRelay(relay, { closedBy = "" } = {}) {
  await patchRelay(relay.id, { status: "closed", closed_at: new Date().toISOString() });
  await queries.setControl(relay.thread_id, "ai").catch(() => {});
  await store
    .recordOutbound({
      channel: relay.customer_channel,
      toPhone: relay.customer_phone,
      author: "system",
      body: `⚑ Relay #${relay.tag} closed${closedBy ? ` by ${closedBy}` : ""}. AI resumed.`,
      status: "sent",
    })
    .catch(() => {});
  const link = adminThreadLink(relay.thread_id);
  await broadcastToStaff(
    `✅ #${relay.tag} ${relay.customer_name || relay.customer_phone || "customer"} closed${closedBy ? ` by ${closedBy}` : ""} — AI resumed.${link ? `\nTranscript: ${link}` : ""}`
  );
  return true;
}

// ---------------------------------------------------------------------------
// Traffic
// ---------------------------------------------------------------------------

/**
 * Mirror an inbound customer message to the staff legs. Call from the inbound
 * webhooks AFTER recordInbound — including on the duplicate-delivery branch:
 * `inboundSid` makes this idempotent, so a webhook that timed out mid-mirror
 * gets completed by Twilio's retry instead of losing the message. Returns the
 * relay when the thread is relayed (callers must then keep the AI silent) or
 * null when it is not.
 */
async function mirrorCustomerMessage({ threadId, body, name, inboundSid = "" }) {
  try {
    if (!relayEnabled()) return null; // flag off = hard no-op, even with stale rows
    const relay = await getActiveRelayByThread(threadId);
    if (!relay) return null;

    if (inboundSid && (await ledgerHas("customer_inbound", inboundSid))) {
      return relay; // already mirrored on a previous delivery — just keep the AI silent
    }

    const label = firstName(name) || firstName(relay.customer_name) || "Customer";
    const text = String(body || "").trim();
    const mirror = `#${relay.tag} ${label}: ${text ? text.slice(0, MIRROR_MAX_CHARS) : "📷 attachment (see admin)"}`;

    // Ledger AFTER the broadcast — deliberately. Staff mirrors are at-least-once:
    // a crash between broadcast and ledger means a webhook retry re-mirrors (staff
    // see the message twice — annoying, harmless). The reverse order would make a
    // crash lose the message for staff entirely, which is far worse. Only
    // customer-BOUND sends need the exactly-once claimLedger treatment.
    const sends = await broadcastToStaff(mirror);
    await recordMirrors(relay.id, sends);
    if (inboundSid) await recordLedger(relay.id, "customer_inbound", inboundSid);
    await patchRelay(relay.id, { last_activity_at: new Date().toISOString() });
    // Keep the hub showing "human control" while the relay is live (rolling window).
    await queries.humanTakeoverThread(threadId).catch(() => {});

    // Staff silent for 30+ min since open and the customer is still writing →
    // give the customer a way out, once.
    if (
      !relay.staff_reply_count &&
      !relay.customer_nudged_at &&
      Date.now() - new Date(relay.created_at).getTime() > 30 * 60000 &&
      relay.customer_phone
    ) {
      await patchRelay(relay.id, { customer_nudged_at: new Date().toISOString() });
      await sendMessage({
        channel: relay.customer_channel,
        to: relay.customer_phone,
        body: "The team has been notified and will reply here as soon as possible. If it's urgent, you can call us on 02 5838 5959.",
        author: "system",
      }).catch(() => {});
    }

    return relay;
  } catch (err) {
    console.error("[relay] mirrorCustomerMessage failed:", err.message);
    return null;
  }
}

/**
 * Entry point for inbound messages from STAFF numbers (both webhooks' staff
 * branch). Routes commands and replies; all feedback to the sender goes over
 * their own leg. Returns true when handled (it always handles — the webhook
 * just acks empty either way).
 */
async function routeStaffMessage({ fromE164, text, quotedSid = "", channel = "whatsapp", messageSid = "" }) {
  try {
    // Flag off = the exact pre-relay behavior: staff messages are silently dropped
    // by the webhook's staff guard (no reply, no routing) — even if stale active
    // rows are left in the table.
    if (!relayEnabled()) return false;

    const from = normalizeE164(fromE164);
    const t = String(text || "").trim();
    if (!from) return false;

    // Twilio redelivers webhooks that time out; a second delivery of the same
    // staff message must not double-send to the customer (or double-close).
    if (messageSid && (await ledgerHas("staff_inbound", messageSid))) return true;

    await lazyCloseIdle();
    const relays = await listActiveRelays();

    if (!t) {
      if (relays.length) await sendToStaffLeg(from, "Only text can be relayed to the customer for now — media is visible in the admin hub.");
      return true;
    }

    const cmd = parseStaffCommand(t);
    const quotedRelayId = cmd.tag == null ? await relayByMirrorSid(quotedSid) : null;
    const target = resolveTarget({ tag: cmd.tag, quotedRelayId, relays });

    // Untagged, unquoted reply about to auto-route to the single active relay:
    // require positive proof that this relay is the last thing we mirrored to
    // THIS staff phone. A mismatch (their last alert was for a since-closed
    // session) OR no verifiable context at all (mirror recording failed, DB
    // lookup error) refuses to guess — a plain reply meant for one customer must
    // never silently go to another.
    if (target.relay && cmd.tag == null && !quotedRelayId && cmd.type === "message") {
      const lastSeen = await lastMirrorRelayForStaff(from);
      if (lastSeen !== target.relay.id) {
        await sendToStaffLeg(
          from,
          `⚠️ Can't confirm which handoff you mean. To reply to ${describeRelay(target.relay)}, quote their message or start with "#${target.relay.tag}".`
        );
        return true;
      }
    }

    if (target.error === "none") {
      await sendToStaffLeg(from, "No active handoffs right now.");
      return true;
    }
    if (target.error === "unknown_tag") {
      await sendToStaffLeg(from, `No active handoff with that number. Active:\n${relays.map(describeRelay).join("\n")}`);
      return true;
    }
    if (target.error === "closed") {
      await sendToStaffLeg(from, "That handoff is already closed. Active:\n" + (relays.map(describeRelay).join("\n") || "none"));
      return true;
    }
    if (target.error === "ambiguous") {
      await sendToStaffLeg(
        from,
        `⚠️ Which customer? Quote their message, or prefix with the tag (e.g. "#${relays[0].tag} your reply"):\n${relays.map(describeRelay).join("\n")}`
      );
      return true;
    }

    const relay = target.relay;

    if (cmd.type === "done") {
      // Duplicate delivery → the other invocation already closed it. A claim
      // ERROR still proceeds: closing twice is harmless, not closing is not.
      const claim = messageSid ? await claimLedger(relay.id, "staff_inbound", messageSid, from) : "claimed";
      if (claim === "duplicate") return true;
      await closeRelay(relay, { closedBy: staffLabel(from) });
      return true;
    }
    if (cmd.type === "link") {
      const link = adminThreadLink(relay.thread_id);
      await sendToStaffLeg(from, link ? `📋 ${describeRelay(relay)}\n${link}` : "Admin link is not configured (ADMIN_DEEP_LINK_BASE).");
      return true;
    }

    // Regular reply → customer. sendMessage logs it on the customer thread and
    // refreshes the human-takeover window.
    if (!relay.customer_phone) {
      await sendToStaffLeg(from, `#${relay.tag} has no customer phone on file — reply from the admin hub instead.${adminThreadLink(relay.thread_id) ? `\n${adminThreadLink(relay.thread_id)}` : ""}`);
      return true;
    }
    // Atomic claim BEFORE the send: concurrent/late webhook retries race on the
    // unique (kind, message_sid) index and only one wins. "duplicate" = another
    // delivery already handled it; "error" = the DB couldn't confirm the claim,
    // and we must NOT send (a retry might double-send) — tell the sender instead.
    // The failure the other way (claimed, then send throws) is reported to staff
    // below, so nothing is silently lost.
    const claim = messageSid ? await claimLedger(relay.id, "staff_inbound", messageSid, from) : "claimed";
    if (claim === "duplicate") return true;
    if (claim === "error") {
      await sendToStaffLeg(from, "⚠️ Couldn't verify delivery safety just now (database hiccup) — your message was NOT sent. Please resend it in a moment.");
      return true;
    }
    try {
      await sendMessage({
        channel: relay.customer_channel,
        to: relay.customer_phone,
        body: cmd.body,
        author: "human",
      });
    } catch (err) {
      console.error("[relay] staff reply send failed:", err.message);
      await sendToStaffLeg(from, `⚠️ Couldn't deliver that to ${relay.customer_phone} (${err.message}). Try the admin hub.`);
      return true;
    }
    await patchRelay(relay.id, {
      staff_reply_count: (relay.staff_reply_count || 0) + 1,
      last_activity_at: new Date().toISOString(),
    });
    // Delivery ack names the recipient, so a reply routed to an unintended
    // session (the residual risk of plain replies) is visible immediately —
    // and cross-mirror so the other staff member doesn't double-answer.
    const [, cross] = await Promise.all([
      sendToStaffLeg(from, `✓ Sent to #${relay.tag} ${firstName(relay.customer_name) || relay.customer_phone}`),
      broadcastToStaff(`↪ ${staffLabel(from)} → #${relay.tag} ${firstName(relay.customer_name) || "customer"}: ${cmd.body.slice(0, 500)}`, { except: from }),
    ]);
    await recordMirrors(relay.id, cross);
    return true;
  } catch (err) {
    console.error("[relay] routeStaffMessage failed:", err.message);
    return false;
  }
}

module.exports = {
  relayEnabled,
  openRelay,
  closeRelay,
  mirrorCustomerMessage,
  routeStaffMessage,
  adminThreadLink,
  customerChannelFor,
  // exported for offline tests
  parseStaffCommand,
  resolveTarget,
  staffLabel,
};
