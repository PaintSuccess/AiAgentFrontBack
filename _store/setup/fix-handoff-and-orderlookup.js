/**
 * One-off fix (2026-07-15) after a live widget voice-call test surfaced two bugs:
 *  1. lookup_order kept failing for a logged-in customer because the agent didn't
 *     pass customer_id — the prompt only weakly said "you may". Strengthen it.
 *  2. escalate_to_human 400'd on website-widget voice (no phone). Backend fixed;
 *     also refresh the tool's description/schema (adds customer_email, clarifies
 *     channel). Updates the EXISTING tool in place — does not create a duplicate.
 *
 * Run once:  node _store/setup/fix-handoff-and-orderlookup.js
 */
import "dotenv/config";

const API_KEY = process.env.ELEVENLABS_API_KEY;
const AGENT_ID = process.env.ELEVENLABS_AGENT_ID;
const BACKEND_URL = process.env.BACKEND_URL || "https://ai-agent-front-back.vercel.app";
const API_SECRET = process.env.API_SECRET_TOKEN;
const ESCALATE_TOOL_ID = "tool_0501kxhyyx8yfjx9ssx65j71w8cf"; // created 2026-07-15

const OLD_LOOKUP_LINE =
  "1. If {{customer_id}} is set, the customer is logged in or matched by trusted caller ID. You may call lookup_order with customer_id/customer_email/customer_phone and either the requested order number or no order number to list recent safe order status. Do not ask for email again unless lookup_order says verification is needed.";
const NEW_LOOKUP_LINE =
  "1. If {{customer_id}} is set, the customer is logged in or matched by trusted caller ID. You MUST pass customer_id (plus customer_email/customer_phone when set) on EVERY lookup_order call for this customer — that is their proof of identity. Do NOT ask them to say or type their email, and NEVER rely on a spoken/typed email in place of customer_id (voice transcription of emails is unreliable and will cause the lookup to fail). Pass either the requested order number or no order number to list recent safe order status. If they name an order number that isn't found, check it against {{customer_recent_orders}} and, if it looks like a mis-hearing, confirm the correct number rather than asking for their email.";

const escalateToolConfig = {
  type: "webhook",
  name: "escalate_to_human",
  description:
    "Use whenever a customer asks to speak with a person, a human, the team, a manager, or says the AI/bot can't help them — on ANY channel (voice call, SMS, WhatsApp, or the website chat widget). " +
    "This is the ONLY correct handoff action. NEVER attempt to transfer, forward, or connect a phone call to a human number — voice calls must stay with you; this tool handles the handoff. " +
    "Default handoff is WhatsApp: the tool gives the customer a link to chat with our support team directly. If the customer says they don't use WhatsApp or would rather not, pass preferred_method \"sms\" and our team will follow up by SMS instead. " +
    "For `channel`, use the CURRENT surface: on a website voice or text chat use \"chat\" (there is no phone number — that's normal, the tool still works and shows the link on screen); use \"voice\" ONLY for an actual phone call; use \"sms\" or \"whatsapp\" on those text channels. " +
    "Always pass customer_phone and customer_email from the dynamic variables when you have them (helps our team identify the customer, especially on the website widget where there's no phone number). " +
    "After the tool returns, relay exactly what its `message` field says to the customer, then continue normally. Do not call this tool more than once for the same request; if it ever returns an error, apologise and give the customer the support number 02 5838 5959.",
  force_pre_tool_speech: true,
  pre_tool_speech: "force",
  tool_call_sound: "typing",
  tool_call_sound_behavior: "always",
  api_schema: {
    url: `${BACKEND_URL}/api/comms/escalate`,
    method: "POST",
    request_headers: { Authorization: `Bearer ${API_SECRET}` },
    request_body_schema: {
      type: "object",
      required: ["channel"],
      properties: {
        channel: {
          type: "string",
          description:
            'The current conversation surface: "chat" (website widget, voice OR text — no phone number), "voice" (actual phone call), "sms", or "whatsapp".',
        },
        customer_phone: {
          type: "string",
          description: "Customer's phone from the customer_phone dynamic variable, if known.",
        },
        customer_email: {
          type: "string",
          description:
            "Customer's email from the customer_email dynamic variable, if known. Helps the team identify the customer when there's no phone number (e.g. website widget).",
        },
        customer_name: { type: "string", description: "Customer's name if known." },
        reason: {
          type: "string",
          description: "One short phrase on why they want a human, e.g. 'order lookup failed', 'wants a refund'.",
        },
        preferred_method: {
          type: "string",
          description: '"whatsapp" (default) or "sms". Use "sms" only if the customer says they don\'t want WhatsApp.',
        },
      },
    },
  },
};

async function updateEscalateTool() {
  console.log(`Updating escalate_to_human tool (${ESCALATE_TOOL_ID}) in place…`);
  const res = await fetch(`https://api.elevenlabs.io/v1/convai/tools/${ESCALATE_TOOL_ID}`, {
    method: "PATCH",
    headers: { "xi-api-key": API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ tool_config: escalateToolConfig }),
  });
  if (!res.ok) throw new Error(`Tool update failed: ${res.status} ${await res.text()}`);
  console.log("  ✅ escalate_to_human updated (customer_email added, channel guidance clarified).");
}

async function updateAgentPrompt() {
  console.log("\nFetching agent prompt…");
  const getRes = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${AGENT_ID}`, {
    headers: { "xi-api-key": API_KEY },
  });
  if (!getRes.ok) throw new Error(`Fetch agent failed: ${getRes.status} ${await getRes.text()}`);
  const agent = await getRes.json();
  const prompt = agent.conversation_config?.agent?.prompt?.prompt || "";

  if (!prompt.includes(OLD_LOOKUP_LINE)) {
    if (prompt.includes(NEW_LOOKUP_LINE)) {
      console.log("  Prompt already updated — nothing to do.");
      return;
    }
    throw new Error("Could not find the exact lookup_order line to replace — prompt may have changed. Aborting to avoid clobbering.");
  }
  const updated = prompt.replace(OLD_LOOKUP_LINE, NEW_LOOKUP_LINE);

  console.log("Patching agent prompt (lookup_order rule strengthened)…");
  const patchRes = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${AGENT_ID}`, {
    method: "PATCH",
    headers: { "xi-api-key": API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ conversation_config: { agent: { prompt: { prompt: updated } } } }),
  });
  if (!patchRes.ok) throw new Error(`Patch agent failed: ${patchRes.status} ${await patchRes.text()}`);
  const result = await patchRes.json();
  const livePrompt = result.conversation_config?.agent?.prompt?.prompt || "";
  console.log("  ✅ Agent prompt updated:", livePrompt.includes(NEW_LOOKUP_LINE) ? "verified live" : "WARNING: not verified");
}

async function run() {
  if (!API_KEY || !AGENT_ID) throw new Error("ELEVENLABS_API_KEY / ELEVENLABS_AGENT_ID missing.");
  if (!API_SECRET) throw new Error("API_SECRET_TOKEN missing.");
  await updateEscalateTool();
  await updateAgentPrompt();
  console.log("\nDone.");
}

run().catch((err) => {
  console.error("\n❌ Error:", err.message);
  process.exit(1);
});
