/**
 * POST /api/comms/contact-update — edit a contact and sync to Shopify.
 * Body: { threadId? | contactId?, name?, email?, tags?, notes? }
 */
const { requireDashboardAuth } = require("../../lib/dashboard-auth");
const { updateContact } = require("../../lib/comms/contacts");
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
  try {
    let contactId = body.contactId;
    if (!contactId && body.threadId) {
      const data = await queries.getThread(String(body.threadId));
      if (!data) return res.status(404).json({ error: "Thread not found" });
      contactId = data.thread.contact?.id;
    }
    if (!contactId) return res.status(400).json({ error: "Missing contactId or threadId" });

    const patch = {};
    if (body.name !== undefined) patch.name = String(body.name).slice(0, 120);
    if (body.email !== undefined) patch.email = String(body.email).slice(0, 200);
    if (Array.isArray(body.tags)) patch.tags = body.tags.map((t) => String(t).trim().slice(0, 40)).filter(Boolean).slice(0, 30);
    if (body.notes !== undefined) patch.notes = String(body.notes).slice(0, 4000);

    const result = await updateContact(contactId, patch);
    return res.status(200).json(result);
  } catch (err) {
    console.error("[comms/contact-update]", err.message);
    return res.status(err.statusCode || 500).json({ error: err.message || "Failed to update contact" });
  }
};
