/**
 * Read + control queries over the comms spine (Supabase). Kept separate from
 * store.js (the write/ingestion layer) so the two concerns stay decoupled.
 */
const { getSupabase } = require("../supabase");
const { normalizeE164 } = require("../whatsapp");

const CONTROL_MODES = ["ai", "human", "paused"];

/** List threads (most-recent first) with their contact, for the inbox list. */
async function listThreads({ limit = 30, status, channel, q } = {}) {
  const sb = getSupabase();
  if (!sb) return { items: [] };

  let query = sb
    .from("threads")
    .select("*, contact:contacts(*)")
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(Math.min(Number(limit) || 30, 100));

  if (status) query = query.eq("status", status);
  if (channel) query = query.eq("last_channel", channel);

  const { data, error } = await query;
  if (error) throw error;

  let items = data || [];
  if (q) {
    const t = String(q).toLowerCase();
    items = items.filter((x) => {
      const c = x.contact || {};
      return (
        String(c.name || "").toLowerCase().includes(t) ||
        String(c.email || "").toLowerCase().includes(t) ||
        String(c.phone || "").includes(t) ||
        String(x.last_message_preview || "").toLowerCase().includes(t)
      );
    });
  }
  return { items };
}

/** One thread with its contact and full message list (chronological). */
async function getThread(threadId) {
  const sb = getSupabase();
  if (!sb || !threadId) return null;

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

/** Set a thread's control mode (ai | human | paused). */
async function setControl(threadId, mode) {
  const sb = getSupabase();
  if (!sb) return null;
  if (!CONTROL_MODES.includes(mode)) {
    const err = new Error("Invalid control mode");
    err.statusCode = 400;
    throw err;
  }
  const { data } = await sb
    .from("threads")
    .update({ control_mode: mode })
    .eq("id", threadId)
    .select("*")
    .maybeSingle();
  return data;
}

/**
 * Look up the control mode for the thread owning a phone number — used by the
 * inbound webhooks to decide whether the AI should auto-reply. Read-only and
 * safe: returns null (→ treat as AI-enabled) on any miss or error.
 */
async function getControlByPhone(phone) {
  try {
    const sb = getSupabase();
    if (!sb) return null;
    const p = normalizeE164(phone);
    if (!p) return null;
    const { data: contact } = await sb
      .from("contacts")
      .select("id")
      .eq("phone", p)
      .maybeSingle();
    if (!contact) return null;
    const { data: thread } = await sb
      .from("threads")
      .select("id, control_mode")
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
  getControlByPhone,
  resolveThreadId,
  CONTROL_MODES,
};
