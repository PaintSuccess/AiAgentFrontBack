/**
 * GET /api/dashboard/messages
 * Fetches Twilio SMS and call logs.
 *
 * Query params:
 *   type       — "sms" or "calls" (default: "sms")
 *   page_size  — 1-100, default 25
 *   page       — page number for Twilio pagination
 *   date_after — ISO date string
 *   date_before — ISO date string
 */
const { requireDashboardAuth } = require("../../lib/dashboard-auth");

const TWILIO_ACCOUNT_SID = (process.env.TWILIO_ACCOUNT_SID || "").trim();
const TWILIO_AUTH_TOKEN = (process.env.TWILIO_AUTH_TOKEN || "").trim();

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = requireDashboardAuth(req, res);
  if (!session) return;

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    return res.status(503).json({
      error: "Twilio not configured",
      message: "Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN environment variables",
    });
  }

  const type = req.query.type === "calls" ? "Calls" : "Messages";
  const pageSize = Math.min(parseInt(req.query.page_size) || 25, 100);

  try {
    const params = new URLSearchParams();
    params.set("PageSize", pageSize);

    if (req.query.date_after) {
      params.set(type === "Calls" ? "StartTime>" : "DateSent>", req.query.date_after);
    }
    if (req.query.date_before) {
      params.set(type === "Calls" ? "StartTime<" : "DateSent<", req.query.date_before);
    }

    const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/${type}.json?${params}`,
      {
        headers: { Authorization: `Basic ${auth}` },
      }
    );

    if (!response.ok) {
      const text = await response.text();
      console.error(`Twilio ${type} error:`, response.status, text);
      return res.status(502).json({ error: `Failed to fetch Twilio ${type.toLowerCase()}` });
    }

    const data = await response.json();
    const records = data[type.toLowerCase()] || data.messages || data.calls || [];

    const items = records.map((rec) => {
      if (type === "Calls") {
        return {
          id: rec.sid,
          type: "call",
          from: rec.from,
          to: rec.to,
          status: rec.status,
          direction: rec.direction,
          duration_seconds: parseInt(rec.duration) || 0,
          started_at: rec.start_time || rec.date_created,
          price: rec.price,
        };
      }
      return {
        id: rec.sid,
        type: rec.from?.includes("whatsapp") ? "whatsapp" : "sms",
        from: rec.from,
        to: rec.to,
        body: rec.body,
        status: rec.status,
        direction: rec.direction,
        started_at: rec.date_sent || rec.date_created,
      };
    });

    return res.status(200).json({
      items,
      has_more: !!data.next_page_uri,
      next_page_uri: data.next_page_uri || null,
    });
  } catch (err) {
    console.error("Dashboard messages error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
