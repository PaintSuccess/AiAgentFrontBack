/**
 * POST /api/twilio/status-callback
 * Receives Twilio message StatusCallback pings (SMS + WhatsApp) and updates the
 * stored message's delivery status (sent → delivered → read, or failed).
 * Wired via the StatusCallback param on outbound sends.
 */
const { cleanEnv } = require("../../lib/shopify");
const { verifyTwilioSignature } = require("../../lib/whatsapp");
const commsStore = require("../../lib/comms/store");

function mapStatus(raw) {
  const s = String(raw || "").toLowerCase();
  if (s === "undelivered") return "failed";
  // queued | sending | sent | delivered | read | failed | received
  return s || null;
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Verify only when a Twilio auth token is configured (matches the inbound handlers).
  if (cleanEnv("TWILIO_AUTH_TOKEN") && !verifyTwilioSignature(req)) {
    return res.status(403).send("Forbidden");
  }

  const body = req.body || {};
  const sid = String(body.MessageSid || body.SmsSid || "").trim();
  const status = mapStatus(body.MessageStatus || body.SmsStatus);

  if (sid && status) {
    await commsStore.recordStatus({
      externalProvider: "twilio",
      externalId: sid,
      status,
      errorCode: body.ErrorCode ? String(body.ErrorCode) : null,
      errorMessage: body.ErrorMessage ? String(body.ErrorMessage) : null,
    });
  }

  // Twilio ignores the body; a fast 204 avoids retries.
  return res.status(204).end();
};
