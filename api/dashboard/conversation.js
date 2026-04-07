/**
 * GET /api/dashboard/conversation?id=conv_xxx
 * Fetches a single conversation detail from ElevenLabs (full transcript + analysis).
 */
const { requireDashboardAuth } = require("../../lib/dashboard-auth");

const ELEVENLABS_API_KEY = (process.env.ELEVENLABS_API_KEY || "").trim();

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

  const convId = (req.query.id || "").trim();
  if (!convId || !/^[a-zA-Z0-9_]+$/.test(convId)) {
    return res.status(400).json({ error: "Invalid conversation ID" });
  }

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversations/${convId}`,
      {
        headers: { "xi-api-key": ELEVENLABS_API_KEY },
      }
    );

    if (!response.ok) {
      if (response.status === 404) {
        return res.status(404).json({ error: "Conversation not found" });
      }
      const text = await response.text();
      console.error("ElevenLabs conversation detail error:", response.status, text);
      return res.status(502).json({ error: "Failed to fetch conversation" });
    }

    const conv = await response.json();

    // Extract customer info from dynamic_variables
    const dynVars = conv.conversation_initiation_client_data?.dynamic_variables || {};

    const result = {
      id: conv.conversation_id,
      agent_name: conv.agent_name,
      status: conv.status,
      source: conv.conversation_initiation_source || "unknown",
      type: mapSource(conv.conversation_initiation_source),

      // Customer
      customer_name: (dynVars.customer_name || "").replace(/^,\s*/, "").trim() || null,
      customer_email: dynVars.customer_email || null,
      customer_id: dynVars.customer_id || null,

      // Timing
      started_at: conv.metadata?.start_time_unix_secs
        ? new Date(conv.metadata.start_time_unix_secs * 1000).toISOString()
        : null,
      duration_seconds: conv.metadata?.call_duration_secs || 0,
      cost: conv.metadata?.cost || 0,
      termination_reason: conv.metadata?.termination_reason || null,

      // Analysis
      call_successful: conv.analysis?.call_successful || null,
      summary: conv.analysis?.transcript_summary || null,
      title: conv.analysis?.call_summary_title || null,

      // Transcript
      transcript: (conv.transcript || []).map((entry) => ({
        role: entry.role,
        message: entry.message,
        timestamp: entry.time_in_call_secs || null,
      })),

      // Feedback
      feedback: conv.metadata?.feedback || null,
    };

    return res.status(200).json(result);
  } catch (err) {
    console.error("Dashboard conversation detail error:", err);
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
