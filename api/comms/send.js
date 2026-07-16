/**
 * POST /api/comms/send — send an outbound message as a human agent and log it.
 * Body: { threadId, channel: "sms"|"whatsapp", body, to?, media?, template?, contact? }
 * Recipient is resolved from the thread's contact unless `to` is given.
 * `contact` ({ name, email, shopifyCustomerId }) only applies to a `to` send: it names
 * the contact that gets created, so an order-initiated message isn't a bare number.
 */
const { requireDashboardAuth } = require("../../lib/dashboard-auth");
const { sendMessage } = require("../../lib/comms/send");
const queries = require("../../lib/comms/queries");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = requireDashboardAuth(req, res);
  if (!session) return;

  const body = req.body || {};
  const channel = String(body.channel || "").toLowerCase();
  const text = typeof body.body === "string" ? body.body : "";
  const media = body.media || null;

  if (!["sms", "whatsapp"].includes(channel)) {
    return res.status(400).json({ error: "channel must be 'sms' or 'whatsapp'" });
  }

  // Identity hints for a `to` send (see sendMessage/contactIdentity).
  //
  // A non-numeric shopifyCustomerId is DROPPED, not rejected: the rest of the app stores
  // the numeric REST id and updateShopifyCustomer() does Number() on it, so letting a
  // GraphQL GID through would poison the contact and turn a later customer write into
  // NaN. Dropping is safe and recoverable — ensureShopifyCustomerId() re-resolves the id
  // from the phone — whereas failing the request would block a legitimate message.
  //
  // `email` is NEVER used to select a contact — only the phone can do that (see
  // contactIdentity in lib/comms/send.js). It is attached afterwards by
  // store.enrichContact, and only if the contact has no email yet.
  const str = (v, max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
  const rawContact = body.contact && typeof body.contact === "object" ? body.contact : null;
  const contact = rawContact
    ? {
        name: str(rawContact.name, 120),
        email: str(rawContact.email, 320),
        shopifyCustomerId: /^\d+$/.test(String(rawContact.shopifyCustomerId || ""))
          ? String(rawContact.shopifyCustomerId)
          : undefined,
      }
    : null;

  try {
    let to = body.to;
    if (!to && body.threadId) {
      const data = await queries.getThread(String(body.threadId));
      if (!data) return res.status(404).json({ error: "Thread not found" });
      const c = data.thread.contact || {};
      to = channel === "whatsapp" ? c.whatsapp || c.phone : c.phone;
    }
    if (!to) return res.status(400).json({ error: "No recipient phone for this channel" });

    // Identity only applies when we're creating/resolving from a raw `to`; a threadId
    // send already has its contact.
    const result = await sendMessage({
      channel,
      to,
      body: text,
      media,
      author: "human",
      template: body.template || null,
      contact: body.threadId ? null : contact,
    });
    return res.status(200).json({ ok: true, result });
  } catch (err) {
    console.error("[comms/send]", err.message);
    return res.status(err.statusCode || 500).json({ error: err.message || "Failed to send" });
  }
};
