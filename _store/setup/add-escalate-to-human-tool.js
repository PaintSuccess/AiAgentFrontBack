/**
 * One-off script: creates the escalate_to_human webhook tool on ElevenLabs
 * and attaches it to the agent without disturbing the existing tool_ids.
 *
 * Run once:  node _store/setup/add-escalate-to-human-tool.js
 */
import "dotenv/config";

const API_KEY = process.env.ELEVENLABS_API_KEY;
const AGENT_ID = process.env.ELEVENLABS_AGENT_ID;
const BACKEND_URL = process.env.BACKEND_URL || "https://ai-agent-front-back.vercel.app";
const API_SECRET = process.env.API_SECRET_TOKEN;

const toolDef = {
  tool_config: {
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
      request_headers: {
        Authorization: `Bearer ${API_SECRET}`,
      },
      request_body_schema: {
        type: "object",
        required: ["channel"],
        properties: {
          channel: {
            type: "string",
            description:
              "The current conversation channel: \"voice\", \"sms\", \"whatsapp\", or \"chat\" (website widget).",
          },
          customer_phone: {
            type: "string",
            description:
              "Customer's phone number from the customer_phone dynamic variable, if known. Required on voice calls.",
          },
          customer_email: {
            type: "string",
            description:
              "Customer's email from the customer_email dynamic variable, if known. Helps the team identify the customer when there's no phone number (e.g. website widget).",
          },
          customer_name: {
            type: "string",
            description: "Customer's name if known.",
          },
          reason: {
            type: "string",
            description: "One short phrase on why they want a human, e.g. 'wants a refund', 'complex order issue'.",
          },
          preferred_method: {
            type: "string",
            description:
              "\"whatsapp\" (default) or \"sms\". Use \"sms\" only if the customer says they don't want to use WhatsApp.",
          },
        },
      },
    },
  },
};

async function run() {
  if (!API_KEY || !AGENT_ID) throw new Error("ELEVENLABS_API_KEY / ELEVENLABS_AGENT_ID missing from env.");
  if (!API_SECRET) throw new Error("API_SECRET_TOKEN missing from env — required for the tool's auth header.");

  console.log("Creating escalate_to_human webhook tool…");
  const createRes = await fetch("https://api.elevenlabs.io/v1/convai/tools", {
    method: "POST",
    headers: { "xi-api-key": API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(toolDef),
  });
  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`Failed to create tool: ${createRes.status} ${err}`);
  }
  const { id: newToolId } = await createRes.json();
  console.log(`  Tool created: ${newToolId}`);

  console.log("\nFetching current agent config…");
  const getRes = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${AGENT_ID}`, {
    headers: { "xi-api-key": API_KEY },
  });
  if (!getRes.ok) {
    const err = await getRes.text();
    throw new Error(`Failed to fetch agent: ${getRes.status} ${err}`);
  }
  const agent = await getRes.json();
  const existingIds = agent.conversation_config?.agent?.prompt?.tool_ids ?? [];
  console.log(`  Current tool_ids (${existingIds.length}): ${existingIds.join(", ")}`);

  if (existingIds.includes(newToolId)) {
    console.log("  Tool already attached — nothing to do.");
    return;
  }
  const updatedIds = [...existingIds, newToolId];

  console.log(`\nAttaching tool to agent (total tools: ${updatedIds.length})…`);
  const patchRes = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${AGENT_ID}`, {
    method: "PATCH",
    headers: { "xi-api-key": API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ conversation_config: { agent: { prompt: { tool_ids: updatedIds } } } }),
  });
  if (!patchRes.ok) {
    const err = await patchRes.text();
    throw new Error(`Failed to patch agent: ${patchRes.status} ${err}`);
  }
  const result = await patchRes.json();
  const liveIds = result.conversation_config?.agent?.prompt?.tool_ids ?? [];
  console.log(`  Agent updated. Live tool_ids (${liveIds.length}):`);
  for (const id of liveIds) console.log(`    - ${id}`);
}

run().catch((err) => {
  console.error("\nError:", err.message);
  process.exit(1);
});
