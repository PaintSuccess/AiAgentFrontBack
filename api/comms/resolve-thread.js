/**
 * GET /api/comms/resolve-thread — find an EXISTING thread for a phone/email.
 * Query: phone, email. Returns { threadId: string | null }.
 *
 * Read-only by design. The Orders page calls this to decide whether clicking an
 * order jumps to a live conversation or opens a pre-filled composer: a contact and
 * thread are created only when a message is actually sent (via /api/comms/send),
 * so merely browsing orders never writes to the comms spine.
 */
const { requireDashboardAuth } = require("../../lib/dashboard-auth");
const { resolveThreadId } = require("../../lib/comms/queries");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const session = requireDashboardAuth(req, res);
  if (!session) return;

  const phone = req.query.phone ? String(req.query.phone) : null;
  const email = req.query.email ? String(req.query.email) : null;
  if (!phone && !email) return res.status(400).json({ error: "Provide phone or email" });

  try {
    // A phone-directed action must resolve by PHONE ONLY.
    //
    // resolveThreadId falls back to an email match, which can return a thread whose
    // contact has a DIFFERENT phone — a shared trade address (info@…) used by several
    // people, or a customer's older number. /api/comms/send takes the recipient from
    // the thread's contact, so opening that thread would send the message to the wrong
    // person. No phone match simply means no conversation yet: the caller composes a
    // new one, and the contact is created against the phone we're actually messaging.
    // Email is only used to resolve when there is no phone to go on at all.
    const threadId = phone ? await resolveThreadId({ phone }) : await resolveThreadId({ email });
    return res.status(200).json({ threadId: threadId || null });
  } catch (err) {
    console.error("[comms/resolve-thread]", err.message);
    return res.status(500).json({ error: "Failed to resolve conversation" });
  }
};
