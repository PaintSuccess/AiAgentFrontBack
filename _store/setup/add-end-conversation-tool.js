/**
 * One-off script: creates the end_conversation client tool on ElevenLabs
 * and attaches it to the agent without disturbing the existing tool_ids.
 *
 * Run once:  node setup/add-end-conversation-tool.js
 */
import "dotenv/config";

const API_KEY  = process.env.ELEVENLABS_API_KEY;
const AGENT_ID = process.env.ELEVENLABS_AGENT_ID;

const toolDef = {
  tool_config: {
    type: "client",
    name: "end_conversation",
    description:
      "MUST be called in the same response as any farewell. When the customer says goodbye, bye, thanks bye, cheers, see ya, all the best, or ends the session — include this tool call alongside your farewell text. Never say goodbye without calling this tool in the same turn. The widget closes automatically after the call.",
    expects_response: false,
    parameters: {
      type: "object",
      properties: {},
    },
  },
};

async function run() {
  // 1. Create the tool
  console.log("Creating end_conversation client tool…");
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
  console.log(`  ✅ Tool created: ${newToolId}`);

  // 2. Get current agent tool_ids so we don't lose existing tools
  console.log("\nFetching current agent config…");
  const getRes = await fetch(
    `https://api.elevenlabs.io/v1/convai/agents/${AGENT_ID}`,
    { headers: { "xi-api-key": API_KEY } }
  );

  if (!getRes.ok) {
    const err = await getRes.text();
    throw new Error(`Failed to fetch agent: ${getRes.status} ${err}`);
  }

  const agent       = await getRes.json();
  const existingIds = agent.conversation_config?.agent?.prompt?.tool_ids ?? [];
  console.log(`  Current tool_ids (${existingIds.length}): ${existingIds.join(", ")}`);

  if (existingIds.includes(newToolId)) {
    console.log("  Tool already attached — nothing to do.");
    return;
  }

  const updatedIds = [...existingIds, newToolId];

  // 3. Patch agent with new tool_ids list
  console.log(`\nAttaching tool to agent (total tools: ${updatedIds.length})…`);
  const patchRes = await fetch(
    `https://api.elevenlabs.io/v1/convai/agents/${AGENT_ID}`,
    {
      method: "PATCH",
      headers: { "xi-api-key": API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        conversation_config: {
          agent: { prompt: { tool_ids: updatedIds } },
        },
      }),
    }
  );

  if (!patchRes.ok) {
    const err = await patchRes.text();
    throw new Error(`Failed to patch agent: ${patchRes.status} ${err}`);
  }

  const result      = await patchRes.json();
  const liveIds     = result.conversation_config?.agent?.prompt?.tool_ids ?? [];
  console.log(`  ✅ Agent updated. Live tool_ids (${liveIds.length}):`);
  for (const id of liveIds) console.log(`    - ${id}`);
}

run().catch((err) => {
  console.error("\n❌ Error:", err.message);
  process.exit(1);
});
