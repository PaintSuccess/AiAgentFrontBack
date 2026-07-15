/**
 * Communications store — data-access + logging layer over Supabase.
 *
 * Design rules:
 *  - One thread per contact; all channels interleave (client's chosen model).
 *  - Every exported `record*` helper is FAIL-SAFE: it catches internally and
 *    returns null on any error, so a Supabase outage never breaks sending/receiving
 *    a real message. Callers may ignore the return value.
 *  - Provider message ids make writes idempotent (webhooks/status callbacks retry).
 *
 * Channels: sms | whatsapp | email | chat | voice
 * Author:   customer | ai | human | system
 */
const { getSupabase } = require("../supabase");
const { normalizeE164 } = require("../whatsapp");

function normPhone(v) {
  return normalizeE164(v) || null;
}
function normEmail(v) {
  const e = String(v || "").trim().toLowerCase();
  return e && e.includes("@") ? e : null;
}
function toIso(v) {
  if (!v) return new Date().toISOString();
  if (v instanceof Date) return v.toISOString();
  const n = Number(v);
  if (Number.isFinite(n) && String(v).length >= 10 && String(v).trim() === String(v)) {
    // treat as unix seconds when it looks like an epoch
    if (n > 1e9 && n < 1e11) return new Date(n * 1000).toISOString();
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}
function preview(body) {
  return String(body || "").replace(/\s+/g, " ").trim().slice(0, 160) || null;
}

const UNIQUE_VIOLATION = "23505";

/** Find-or-create a contact by phone → email → shopify id; backfill missing fields. */
async function resolveContact(sb, input) {
  const phone = normPhone(input.phone || input.fromPhone || input.toPhone);
  const email = normEmail(input.email);
  const whatsapp = normPhone(input.whatsapp) || phone;
  const name = String(input.name || "").trim() || null;
  const shopifyCustomerId = input.shopifyCustomerId ? String(input.shopifyCustomerId) : null;

  if (!phone && !email && !shopifyCustomerId) return null; // nothing to identify by

  let contact = null;
  const findBy = async (col, val) =>
    val
      ? (await sb.from("contacts").select("*").eq(col, val).limit(1).maybeSingle()).data
      : null;

  // Track HOW we matched — back-filling depends on it (see below).
  let matchedBy = null;
  contact = await findBy("phone", phone);
  if (contact) matchedBy = "phone";
  if (!contact) {
    contact = await findBy("email", email);
    if (contact) matchedBy = "email";
  }
  if (!contact) {
    contact = await findBy("shopify_customer_id", shopifyCustomerId);
    if (contact) matchedBy = "shopify_customer_id";
  }

  if (contact) {
    const patch = {};
    // Never let a match on an EMAIL alone attach a phone number to an existing contact.
    // Email is the weakest identifier here: callers can supply an arbitrary one (the
    // public SMS form did), so allowing it to bind a phone means typing a stranger's
    // address is enough to take over their contact and thread — and any later staff
    // reply from that thread goes to the wrong number. A phone match is proof enough
    // to back-fill an email; the reverse is not true. If a genuine email-only contact
    // later texts in, this creates a separate contact for staff to merge deliberately.
    if (phone && !contact.phone && matchedBy !== "email") patch.phone = phone;
    if (email && !contact.email) patch.email = email;
    // Same rule for whatsapp — it defaults to `phone` above, so an email-only match
    // could otherwise bind the caller's number here instead.
    if (whatsapp && !contact.whatsapp && matchedBy !== "email") patch.whatsapp = whatsapp;
    if (name && !contact.name) patch.name = name;
    if (shopifyCustomerId && !contact.shopify_customer_id)
      patch.shopify_customer_id = shopifyCustomerId;
    if (Object.keys(patch).length) {
      const { data } = await sb
        .from("contacts")
        .update(patch)
        .eq("id", contact.id)
        .select("*")
        .single();
      if (data) contact = data;
    }
    return contact;
  }

  const { data, error } = await sb
    .from("contacts")
    .insert({
      phone,
      email,
      whatsapp,
      name,
      shopify_customer_id: shopifyCustomerId,
    })
    .select("*")
    .single();

  if (error) {
    // Concurrent insert won the race — re-resolve.
    if (error.code === UNIQUE_VIOLATION) {
      return (
        (await findBy("phone", phone)) ||
        (await findBy("email", email)) ||
        (await findBy("shopify_customer_id", shopifyCustomerId))
      );
    }
    throw error;
  }
  return data;
}

/** One thread per contact. */
async function getOrCreateThread(sb, contactId) {
  const existing = (
    await sb.from("threads").select("*").eq("contact_id", contactId).limit(1).maybeSingle()
  ).data;
  if (existing) return existing;

  const { data, error } = await sb
    .from("threads")
    .insert({ contact_id: contactId })
    .select("*")
    .single();
  if (error) {
    const retry = (
      await sb.from("threads").select("*").eq("contact_id", contactId).limit(1).maybeSingle()
    ).data;
    if (retry) return retry;
    throw error;
  }
  return data;
}

/** Insert (or idempotently upsert by provider id) a message + roll up the thread. */
async function insertMessage(sb, thread, contactId, m) {
  const row = {
    thread_id: thread.id,
    contact_id: contactId,
    channel: m.channel,
    direction: m.direction,
    author: m.author,
    body: m.body || null,
    media: m.media || null,
    status: m.status || null,
    external_provider: m.externalProvider || null,
    external_id: m.externalId || null,
    error_code: m.errorCode || null,
    error_message: m.errorMessage || null,
    cost: m.cost ?? null,
    metadata: m.metadata || null,
    sent_at: toIso(m.sentAt),
  };

  // Idempotency: if we've already stored this provider id, update it instead.
  if (row.external_provider && row.external_id) {
    const existing = (
      await sb
        .from("messages")
        .select("id")
        .eq("external_provider", row.external_provider)
        .eq("external_id", row.external_id)
        .limit(1)
        .maybeSingle()
    ).data;
    if (existing) {
      const { data } = await sb
        .from("messages")
        .update(row)
        .eq("id", existing.id)
        .select("*")
        .single();
      return { message: data, isNew: false };
    }
  }

  const { data, error } = await sb.from("messages").insert(row).select("*").single();
  if (error) {
    if (error.code === UNIQUE_VIOLATION && row.external_provider && row.external_id) {
      const dup = (
        await sb
          .from("messages")
          .select("*")
          .eq("external_provider", row.external_provider)
          .eq("external_id", row.external_id)
          .limit(1)
          .maybeSingle()
      ).data;
      if (dup) return { message: dup, isNew: false };
    }
    throw error;
  }
  return { message: data, isNew: true };
}

async function rollUpThread(sb, thread, m, isNew) {
  if (!isNew) return;
  const patch = {
    last_message_at: toIso(m.sentAt),
    last_message_preview: preview(m.body),
    last_channel: m.channel,
  };
  if (m.direction === "inbound") {
    patch.unread_count = (thread.unread_count || 0) + 1;
  }
  await sb.from("threads").update(patch).eq("id", thread.id);
}

async function recordEvent(sb, { contactId, messageId, threadId, type, channel, data, occurredAt }) {
  await sb.from("events").insert({
    contact_id: contactId || null,
    message_id: messageId || null,
    thread_id: threadId || null,
    type,
    channel: channel || null,
    data: data || null,
    occurred_at: toIso(occurredAt),
  });
}

// ── Public, fail-safe helpers (callers may ignore return / errors) ─────────────

/** Log an inbound message from a customer. */
async function recordInbound(input) {
  try {
    const sb = getSupabase();
    if (!sb) return null;
    const contact = await resolveContact(sb, input);
    if (!contact) return null;
    const thread = await getOrCreateThread(sb, contact.id);
    const { message, isNew } = await insertMessage(sb, thread, contact.id, {
      ...input,
      direction: "inbound",
      author: input.author || "customer",
      status: input.status || "received",
    });
    await rollUpThread(sb, thread, { ...input, direction: "inbound" }, isNew);
    if (isNew) {
      await recordEvent(sb, {
        contactId: contact.id,
        messageId: message.id,
        threadId: thread.id,
        type: "message_received",
        channel: input.channel,
        occurredAt: input.sentAt,
      });
    }
    return { contact, thread, message, isNew };
  } catch (err) {
    console.error("[comms-store] recordInbound failed:", err.message);
    return null;
  }
}

/** Log an outbound message (from ai / human / system). */
async function recordOutbound(input) {
  try {
    const sb = getSupabase();
    if (!sb) return null;
    const contact = await resolveContact(sb, input);
    if (!contact) return null;
    const thread = await getOrCreateThread(sb, contact.id);
    const { message, isNew } = await insertMessage(sb, thread, contact.id, {
      ...input,
      direction: "outbound",
      author: input.author || "ai",
      status: input.status || "sent",
    });
    await rollUpThread(sb, thread, { ...input, direction: "outbound" }, isNew);
    if (isNew) {
      await recordEvent(sb, {
        contactId: contact.id,
        messageId: message.id,
        threadId: thread.id,
        type: "message_sent",
        channel: input.channel,
        occurredAt: input.sentAt,
      });
    }
    return { contact, thread, message };
  } catch (err) {
    console.error("[comms-store] recordOutbound failed:", err.message);
    return null;
  }
}

/** Update delivery status for a previously-sent message, keyed by provider id. */
async function recordStatus({ externalProvider, externalId, status, errorCode, errorMessage }) {
  try {
    const sb = getSupabase();
    if (!sb || !externalProvider || !externalId || !status) return null;
    const { data } = await sb
      .from("messages")
      .update({
        status,
        error_code: errorCode || null,
        error_message: errorMessage || null,
      })
      .eq("external_provider", externalProvider)
      .eq("external_id", externalId)
      .select("id, contact_id, thread_id, channel")
      .maybeSingle();
    if (data) {
      await recordEvent(sb, {
        contactId: data.contact_id,
        messageId: data.id,
        threadId: data.thread_id,
        type: `message_${status}`,
        channel: data.channel,
      });
    }
    return data || null;
  } catch (err) {
    console.error("[comms-store] recordStatus failed:", err.message);
    return null;
  }
}

/**
 * Log a finished ElevenLabs conversation (voice call or widget chat).
 * Stores a voice_calls row (for calls) and one thread message carrying the
 * transcript, so the conversation appears in the unified timeline.
 */
async function recordConversation(input) {
  try {
    const sb = getSupabase();
    if (!sb) return null;
    const contact = await resolveContact(sb, input);
    if (!contact) return null; // anonymous widget chat with no phone/email — skip
    const thread = await getOrCreateThread(sb, contact.id);

    const channel = input.channel === "call" ? "voice" : input.channel || "chat";
    const isVoice = channel === "voice";

    const { message, isNew } = await insertMessage(sb, thread, contact.id, {
      channel,
      direction: input.direction || "inbound",
      author: "ai",
      body: input.summary || input.title || `${channel} conversation`,
      status: input.status || "received",
      externalProvider: "elevenlabs",
      externalId: input.conversationId || null,
      cost: input.cost,
      metadata: {
        title: input.title || null,
        result: input.result || null,
        duration_seconds: input.durationSeconds || null,
        transcript: input.transcript || null,
      },
      sentAt: input.startedAt,
    });
    await rollUpThread(sb, thread, { ...input, channel, direction: "inbound", body: input.summary || input.title }, isNew);

    if (isVoice) {
      const callRow = {
        message_id: message.id,
        thread_id: thread.id,
        contact_id: contact.id,
        twilio_call_sid: input.twilioCallSid || null,
        elevenlabs_conversation_id: input.conversationId || null,
        direction: input.direction || null,
        status: input.status || null,
        duration_seconds: input.durationSeconds || null,
        recording_url: input.recordingUrl || null,
        transcript: input.transcript || null,
        summary: input.summary || null,
        result: input.result || null,
        started_at: input.startedAt ? toIso(input.startedAt) : null,
      };
      if (input.conversationId) {
        const existing = (
          await sb
            .from("voice_calls")
            .select("id")
            .eq("elevenlabs_conversation_id", input.conversationId)
            .limit(1)
            .maybeSingle()
        ).data;
        if (existing) await sb.from("voice_calls").update(callRow).eq("id", existing.id);
        else await sb.from("voice_calls").insert(callRow);
      } else {
        await sb.from("voice_calls").insert(callRow);
      }
    }

    return { contact, thread, message };
  } catch (err) {
    console.error("[comms-store] recordConversation failed:", err.message);
    return null;
  }
}

module.exports = {
  recordInbound,
  recordOutbound,
  recordStatus,
  recordConversation,
  // exported for tests / advanced callers
  _internal: { resolveContact, getOrCreateThread, getSupabase },
};
