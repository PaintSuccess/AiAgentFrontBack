/**
 * GET /api/dashboard/conversations
 * Proxies ElevenLabs conversations list with filtering and pagination.
 *
 * Query params (all optional):
 *   page_size      — 1-100, default 25
 *   cursor         — pagination cursor from previous response
 *   search         — full-text search across transcripts
 *   call_successful — "true" or "false"
 *   start_after    — unix timestamp (seconds)
 *   start_before   — unix timestamp (seconds)
 */
const { requireDashboardAuth } = require("../../lib/dashboard-auth");

const ELEVENLABS_API_KEY = (process.env.ELEVENLABS_API_KEY || "").trim();
const ELEVENLABS_AGENT_ID = (process.env.ELEVENLABS_AGENT_ID || "").trim();

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

  try {
    // Build ElevenLabs API query
    const params = new URLSearchParams();
    params.set("agent_id", ELEVENLABS_AGENT_ID);
    params.set("page_size", Math.min(parseInt(req.query.page_size) || 25, 100));

    if (req.query.cursor) params.set("cursor", req.query.cursor);
    if (req.query.search) params.set("search", req.query.search.slice(0, 200));
    if (req.query.call_successful) params.set("call_successful", req.query.call_successful);
    if (req.query.start_after) params.set("call_start_after_unix", req.query.start_after);
    if (req.query.start_before) params.set("call_start_before_unix", req.query.start_before);

    const response = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversations?${params}`,
      {
        headers: { "xi-api-key": ELEVENLABS_API_KEY },
      }
    );

    if (!response.ok) {
      const text = await response.text();
      console.error("ElevenLabs conversations error:", response.status, text);
      return res.status(502).json({ error: "Failed to fetch conversations" });
    }

    const data = await response.json();
    const convList = data.conversations || [];

    // Fetch detail for each conversation in parallel to get customer info
    // (the list endpoint doesn't include dynamic_variables with customer data)
    const details = await Promise.allSettled(
      convList.map((conv) =>
        fetch(
          `https://api.elevenlabs.io/v1/convai/conversations/${conv.conversation_id}`,
          { headers: { "xi-api-key": ELEVENLABS_API_KEY } }
        ).then((r) => (r.ok ? r.json() : null))
      )
    );

    const items = convList.map((conv, i) => {
      const detail = details[i]?.value || null;
      const dynVars = detail?.conversation_initiation_client_data?.dynamic_variables || {};
      const customerName = (dynVars.customer_name || "").replace(/^,\s*/, "").trim() || null;
      const customerEmail = dynVars.customer_email || null;

      return {
        id: conv.conversation_id,
        type: mapSource(conv.conversation_initiation_source),
        status: conv.status,
        call_successful: conv.call_successful,
        started_at: conv.start_time_unix_secs
          ? new Date(conv.start_time_unix_secs * 1000).toISOString()
          : null,
        duration_seconds: conv.call_duration_secs || 0,
        cost: conv.cost,
        source: conv.conversation_initiation_source || "unknown",
        customer_name: customerName,
        customer_email: customerEmail,
        summary: conv.call_summary_title || null,
      };
    });

    return res.status(200).json({
      items,
      cursor: data.next_cursor || null,
      has_more: !!data.has_more,
    });
  } catch (err) {
    console.error("Dashboard conversations error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

function mapSource(source) {
  if (!source) return "chat";
  const s = source.toLowerCase();
  if (s.includes("phone") || s.includes("twilio")) return "call";
  if (s.includes("sms")) return "sms";
  if (s.includes("whatsapp")) return "whatsapp";
  return "chat";
}
