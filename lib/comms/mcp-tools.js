/**
 * MCP tool handlers for the communications control center — lets the ChatGPT
 * Operations agent read the unified inbox and send/takeover on any channel,
 * using the same store + send service as the human inbox.
 *
 * Sending a customer message requires an approval_reference, matching the
 * existing gmail_send_email / shopify_send_customer_email safety pattern.
 */
const queries = require("./queries");
const { sendMessage } = require("./send");
const { startOutboundCall } = require("./call");

function badRequest(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function mapThread(t) {
  if (!t) return null;
  const c = t.contact || {};
  return {
    thread_id: t.id,
    contact: {
      name: c.name || null,
      phone: c.phone || null,
      email: c.email || null,
      shopify_customer_id: c.shopify_customer_id || null,
    },
    control_mode: t.control_mode,
    unread: t.unread_count,
    last_channel: t.last_channel,
    last_message_at: t.last_message_at,
    last_message_preview: t.last_message_preview,
  };
}

async function commsSearchThreads(args = {}) {
  const { items } = await queries.listThreads({
    q: args.query,
    limit: args.limit || 20,
    channel: args.channel,
    status: args.status,
  });
  return { threads: items.map(mapThread) };
}

async function commsGetThread(args = {}) {
  const threadId = await queries.resolveThreadId({
    threadId: args.thread_id,
    phone: args.phone,
    email: args.email,
  });
  if (!threadId) throw badRequest("No matching conversation found.", 404);

  const data = await queries.getThread(threadId);
  if (!data) throw badRequest("No matching conversation found.", 404);

  return {
    conversation: mapThread(data.thread),
    messages: (data.messages || []).map((m) => ({
      direction: m.direction,
      author: m.author,
      channel: m.channel,
      body: m.body,
      status: m.status,
      sent_at: m.sent_at,
    })),
  };
}

async function commsSendMessage(args = {}) {
  const channel = String(args.channel || "").toLowerCase();
  if (!["sms", "whatsapp"].includes(channel)) {
    throw badRequest("channel must be 'sms' or 'whatsapp'.");
  }
  if (!args.approval_reference) {
    throw badRequest("approval_reference is required before sending a customer message.");
  }
  if (!args.body) throw badRequest("body is required.");

  let to = args.phone;
  if (!to && (args.thread_id || args.email)) {
    const threadId = await queries.resolveThreadId({
      threadId: args.thread_id,
      email: args.email,
    });
    if (threadId) {
      const d = await queries.getThread(threadId);
      const c = d?.thread?.contact || {};
      to = channel === "whatsapp" ? c.whatsapp || c.phone : c.phone;
    }
  }
  if (!to) {
    throw badRequest("No recipient phone resolved. Provide phone, or a thread_id/email that maps to one.");
  }

  const result = await sendMessage({ channel, to, body: args.body, author: "human" });
  return {
    sent: true,
    channel,
    to,
    external_id: result.id || null,
    status: result.status || "sent",
    approval_reference: args.approval_reference,
  };
}

async function commsSetControl(args = {}, mode) {
  const threadId = await queries.resolveThreadId({
    threadId: args.thread_id,
    phone: args.phone,
    email: args.email,
  });
  if (!threadId) throw badRequest("No matching conversation found.", 404);
  const thread = await queries.setControl(threadId, mode);
  return { thread_id: threadId, control_mode: thread?.control_mode || mode, ok: true };
}

const commsTakeOver = (args) => commsSetControl(args, "human");
const commsHandBack = (args) => commsSetControl(args, "ai");

async function commsStartCall(args = {}) {
  if (!args.approval_reference) {
    throw badRequest("approval_reference is required before calling a customer.");
  }
  let to = args.phone;
  let name, email, shopifyCustomerId;
  if (!to && (args.thread_id || args.email)) {
    const threadId = await queries.resolveThreadId({ threadId: args.thread_id, email: args.email });
    if (threadId) {
      const d = await queries.getThread(threadId);
      const c = d?.thread?.contact || {};
      to = c.phone;
      name = c.name;
      email = c.email;
      shopifyCustomerId = c.shopify_customer_id;
    }
  }
  if (!to) throw badRequest("No recipient phone resolved. Provide phone, or a thread_id/email that maps to one.");

  const r = await startOutboundCall({ to, name, email, shopifyCustomerId });
  return {
    call_started: true,
    to: r.to,
    conversation_id: r.conversation_id,
    approval_reference: args.approval_reference,
  };
}

module.exports = {
  commsSearchThreads,
  commsGetThread,
  commsSendMessage,
  commsTakeOver,
  commsHandBack,
  commsStartCall,
};
