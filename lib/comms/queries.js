/**
 * Read + control queries over the comms spine (Supabase). Kept separate from
 * store.js (the write/ingestion layer) so the two concerns stay decoupled.
 */
const { getSupabase } = require("../supabase");
const { normalizeE164 } = require("../whatsapp");

const CONTROL_MODES = ["ai", "human", "paused"];

// How long the AI stays paused after a human's last activity before it
// auto-hands control back (rolling window, reset on each human send/takeover).
const AI_TAKEOVER_MINUTES = 30;
const pauseUntil = () => new Date(Date.now() + AI_TAKEOVER_MINUTES * 60000).toISOString();

const THREAD_FIELDS = ["status", "starred", "pinned", "labels", "assigned_to", "snoozed_until", "ai_paused_until"];

/**
 * Proactively flip any human/paused thread whose pause window has lapsed back
 * to AI control. Without this, the handback only happened reactively when the
 * CUSTOMER sent a new message — if they went quiet, the thread stayed in
 * "Human control" forever regardless of the timer. Called from listThreads()
 * and getThread() so it self-corrects on the UI's normal polling (no cron
 * needed), independent of whether a new customer message ever arrives.
 */
async function sweepExpiredControl(sb) {
  try {
    await sb
      .from("threads")
      .update({ control_mode: "ai", ai_paused_until: null })
      .neq("control_mode", "ai")
      .lt("ai_paused_until", new Date().toISOString());
  } catch (err) {
    console.error("[comms-queries] sweepExpiredControl failed:", err.message);
  }
}

/**
 * List threads for the inbox, pinned first then most-recent. Supports folder
 * filters and server-side search across contacts + message bodies (so search
 * covers all history, not just the loaded page).
 */
async function listThreads({ limit = 50, q, folder = "all", channel, currentUser } = {}) {
  const sb = getSupabase();
  if (!sb) return { items: [] };
  await sweepExpiredControl(sb);
  const lim = Math.min(Number(limit) || 50, 200);

  // Server-side search → collect candidate thread ids from contacts + messages.
  let idFilter = null;
  if (q && String(q).trim()) {
    // Strip characters that would corrupt the PostgREST .or() filter string.
    const term = String(q).trim().replace(/[,()"\\]/g, " ").trim();
    if (!term) return { items: [] };
    const like = `%${term}%`;
    const digits = term.replace(/\D/g, "");
    const orParts = [`name.ilike.${like}`, `email.ilike.${like}`, `phone.ilike.${like}`];
    if (digits) orParts.push(`phone.ilike.%${digits}%`);

    const { data: cts } = await sb.from("contacts").select("id").or(orParts.join(","));
    const contactIds = (cts || []).map((c) => c.id);
    const ids = new Set();
    if (contactIds.length) {
      const { data: th } = await sb.from("threads").select("id").in("contact_id", contactIds);
      (th || []).forEach((t) => ids.add(t.id));
    }
    const { data: msgs } = await sb.from("messages").select("thread_id").ilike("body", like).limit(500);
    (msgs || []).forEach((m) => m.thread_id && ids.add(m.thread_id));

    idFilter = [...ids];
    if (idFilter.length === 0) return { items: [] };
  }

  // Channel filter = threads that CONTAIN a message on this channel (so the
  // Voice tab shows every thread with a call, not just where the last msg was one).
  if (channel) {
    const { data: chMsgs } = await sb.from("messages").select("thread_id").eq("channel", channel);
    const chIds = [...new Set((chMsgs || []).map((m) => m.thread_id).filter(Boolean))];
    idFilter = idFilter ? idFilter.filter((id) => chIds.includes(id)) : chIds;
    if (idFilter.length === 0) return { items: [] };
  }

  let query = sb.from("threads").select("*, contact:contacts(*)");
  if (idFilter) query = query.in("id", idFilter);

  switch (folder) {
    case "unread": query = query.gt("unread_count", 0); break;
    case "open":
    case "pending":
    case "closed":
    case "snoozed": query = query.eq("status", folder); break;
    case "starred": query = query.eq("starred", true); break;
    case "pinned": query = query.eq("pinned", true); break;
    case "mine": if (currentUser) query = query.eq("assigned_to", currentUser); break;
    case "unassigned": query = query.is("assigned_to", null); break;
    default: break; // all
  }

  query = query
    .order("pinned", { ascending: false })
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(lim);

  const { data, error } = await query;
  if (error) throw error;
  return { items: data || [] };
}

/** Aggregate counts for the folder + channel badges. */
async function getInboxCounts(currentUser) {
  const sb = getSupabase();
  if (!sb) return {};
  const { data } = await sb
    .from("threads")
    .select("last_channel, unread_count, status, starred, pinned, assigned_to");
  const rows = data || [];
  const channels = {};
  const status = { open: 0, pending: 0, closed: 0, snoozed: 0 };
  let unread = 0, unassigned = 0, mine = 0, starred = 0, pinned = 0;
  for (const r of rows) {
    if (r.unread_count > 0) {
      unread++;
      if (r.last_channel) channels[r.last_channel] = (channels[r.last_channel] || 0) + 1;
    }
    if (!r.assigned_to) unassigned++;
    if (currentUser && r.assigned_to === currentUser) mine++;
    if (r.starred) starred++;
    if (r.pinned) pinned++;
    if (status[r.status] !== undefined) status[r.status]++;
  }
  return { total: rows.length, unread, unassigned, mine, starred, pinned, channels, status };
}

/** Update arbitrary thread state fields (status, star, pin, labels, assignment). */
async function setThreadFields(threadId, fields = {}) {
  const sb = getSupabase();
  if (!sb) return null;
  const patch = {};
  for (const k of THREAD_FIELDS) if (k in fields) patch[k] = fields[k];
  if (!Object.keys(patch).length) return null;
  const { data } = await sb.from("threads").update(patch).eq("id", threadId).select("*").maybeSingle();
  return data;
}

/** One thread with its contact and full message list (chronological). */
async function getThread(threadId) {
  const sb = getSupabase();
  if (!sb || !threadId) return null;
  await sweepExpiredControl(sb);

  const { data: thread } = await sb
    .from("threads")
    .select("*, contact:contacts(*)")
    .eq("id", threadId)
    .maybeSingle();
  if (!thread) return null;

  const { data: messages } = await sb
    .from("messages")
    .select("*")
    .eq("thread_id", threadId)
    .order("sent_at", { ascending: true })
    .limit(500);

  return { thread, messages: messages || [] };
}

/** Clear the unread badge for a thread. */
async function markRead(threadId) {
  const sb = getSupabase();
  if (!sb || !threadId) return;
  await sb.from("threads").update({ unread_count: 0 }).eq("id", threadId);
}

/** Set a thread's control mode. Human control opens/refreshes the AI-pause
 *  window; handing back to AI clears it. */
async function setControl(threadId, mode) {
  const sb = getSupabase();
  if (!sb) return null;
  if (!CONTROL_MODES.includes(mode)) {
    const err = new Error("Invalid control mode");
    err.statusCode = 400;
    throw err;
  }
  const patch = { control_mode: mode, ai_paused_until: mode === "ai" ? null : pauseUntil() };
  const { data } = await sb
    .from("threads")
    .update(patch)
    .eq("id", threadId)
    .select("*")
    .maybeSingle();
  return data;
}

/** A human sent a message → take over this thread and (re)start the pause window. */
async function humanTakeoverThread(threadId) {
  const sb = getSupabase();
  if (!sb || !threadId) return null;
  const { data } = await sb
    .from("threads")
    .update({ control_mode: "human", ai_paused_until: pauseUntil() })
    .eq("id", threadId)
    .select("id, control_mode, ai_paused_until")
    .maybeSingle();
  return data;
}

/**
 * Inbound gate: decide whether the AI should auto-reply to a customer message,
 * applying the takeover timeout. If a human took over but has gone quiet past
 * the window, auto-hand control back to the AI. Fail-safe: returns aiEnabled
 * true on any miss/error so a glitch never silences the AI permanently.
 */
async function evaluateInboundControl(phone) {
  try {
    const sb = getSupabase();
    if (!sb) return { aiEnabled: true };
    const p = normalizeE164(phone);
    if (!p) return { aiEnabled: true };

    const { data: contact } = await sb.from("contacts").select("id").eq("phone", p).maybeSingle();
    if (!contact) return { aiEnabled: true };
    const { data: thread } = await sb
      .from("threads")
      .select("id, control_mode, ai_paused_until")
      .eq("contact_id", contact.id)
      .maybeSingle();
    if (!thread || thread.control_mode === "ai") return { aiEnabled: true };

    // control_mode is human/paused
    const until = thread.ai_paused_until ? new Date(thread.ai_paused_until).getTime() : 0;
    if (until && Date.now() >= until) {
      // Human went quiet past the window → auto-hand back to the AI.
      await sb.from("threads").update({ control_mode: "ai", ai_paused_until: null }).eq("id", thread.id);
      return { aiEnabled: true, handedBack: true, threadId: thread.id };
    }
    // Human is (recently) active → AI stays silent.
    return { aiEnabled: false, control_mode: thread.control_mode, threadId: thread.id };
  } catch (err) {
    console.error("[comms-queries] evaluateInboundControl failed:", err.message);
    return { aiEnabled: true };
  }
}

/** Back-compat read-only control lookup (no side effects). */
async function getControlByPhone(phone) {
  try {
    const sb = getSupabase();
    if (!sb) return null;
    const p = normalizeE164(phone);
    if (!p) return null;
    const { data: contact } = await sb.from("contacts").select("id").eq("phone", p).maybeSingle();
    if (!contact) return null;
    const { data: thread } = await sb
      .from("threads")
      .select("id, control_mode, ai_paused_until")
      .eq("contact_id", contact.id)
      .maybeSingle();
    return thread || null;
  } catch (err) {
    console.error("[comms-queries] getControlByPhone failed:", err.message);
    return null;
  }
}

/** Resolve a thread id from a thread id, phone, or email (first match wins). */
async function resolveThreadId({ threadId, phone, email } = {}) {
  const sb = getSupabase();
  if (!sb) return null;
  if (threadId) return String(threadId);

  let contactId = null;
  const p = normalizeE164(phone);
  if (p) {
    const { data } = await sb.from("contacts").select("id").eq("phone", p).maybeSingle();
    contactId = data?.id || null;
  }
  if (!contactId && email) {
    const e = String(email).trim().toLowerCase();
    const { data } = await sb.from("contacts").select("id").eq("email", e).maybeSingle();
    contactId = data?.id || null;
  }
  if (!contactId) return null;

  const { data: thread } = await sb
    .from("threads")
    .select("id")
    .eq("contact_id", contactId)
    .maybeSingle();
  return thread?.id || null;
}

module.exports = {
  listThreads,
  getThread,
  markRead,
  setControl,
  setThreadFields,
  getInboxCounts,
  getControlByPhone,
  evaluateInboundControl,
  humanTakeoverThread,
  resolveThreadId,
  CONTROL_MODES,
  AI_TAKEOVER_MINUTES,
};
