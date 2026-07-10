/**
 * POST /api/comms/send — send an outbound message as a human agent and log it.
 * Body: { threadId, channel: "sms"|"whatsapp", body, to?, media? }
 * Recipient is resolved from the thread's contact unless `to` is given.
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

  try {
    let to = body.to;
    if (!to && body.threadId) {
      const data = await queries.getThread(String(body.threadId));
      if (!data) return res.status(404).json({ error: "Thread not found" });
      const c = data.thread.contact || {};
      to = channel === "whatsapp" ? c.whatsapp || c.phone : c.phone;
    }
    if (!to) return res.status(400).json({ error: "No recipient phone for this channel" });

    const result = await sendMessage({ channel, to, body: text, media, author: "human" });
    return res.status(200).json({ ok: true, result });
  } catch (err) {
    console.error("[comms/send]", err.message);
    return res.status(err.statusCode || 500).json({ error: err.message || "Failed to send" });
  }
};
