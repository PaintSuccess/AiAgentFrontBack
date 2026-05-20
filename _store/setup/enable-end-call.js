import "dotenv/config";

// Enable the ElevenLabs built-in `end_call` SYSTEM tool on the agent.
//
// Why: a custom client-tool named `end_conversation` does NOT terminate
// the ElevenLabs session — it just runs JS in the browser. The agent's
// WebSocket stays open and the widget never gets a disconnect event.
//
// The built-in `end_call` is different: when the LLM calls it, the
// ElevenLabs server itself ends the session, the SDK fires
// onDisconnect → our `elevenlabs-convai:disconnect` listener closes the
// widget. This is the documented, supported path.
//
// We also REMOVE the old `end_conversation` client tool from the agent
// because it competes with `end_call` and confuses the LLM about which
// to call.

const API_KEY = process.env.ELEVENLABS_API_KEY;
const AGENT_ID = process.env.ELEVENLABS_AGENT_ID;
const OLD_END_CONVO_TOOL_ID = "tool_6401ks1rm2bdebdb9v06dtngq504";

async function main() {
  console.log("Fetching current agent…");
  const r = await fetch(
    `https://api.elevenlabs.io/v1/convai/agents/${AGENT_ID}`,
    { headers: { "xi-api-key": API_KEY } }
  );
  if (!r.ok) throw new Error(`GET agent ${r.status}: ${await r.text()}`);
  const agent = await r.json();

  const currentToolIds = agent.conversation_config?.agent?.prompt?.tool_ids || [];
  const currentBuiltIn = agent.conversation_config?.agent?.prompt?.built_in_tools || {};

  console.log("Current tool_ids:", currentToolIds);
  console.log(
    "Current built_in_tools.end_call:",
    JSON.stringify(currentBuiltIn.end_call)
  );

  // Filter out the old end_conversation client tool
  const newToolIds = currentToolIds.filter((id) => id !== OLD_END_CONVO_TOOL_ID);

  // Build new built_in_tools — preserve all existing keys, enable end_call
  const newBuiltIn = { ...currentBuiltIn };
  newBuiltIn.end_call = {
    name: "end_call",
    description:
      "End the call when the customer signals they are done — they say goodbye, bye, cheers, see ya, thanks bye, all the best, happy painting, or otherwise indicate the conversation is over. Call this in the SAME response as your one-sentence farewell. Do not call for a casual mid-conversation 'thanks'.",
    response_timeout_secs: 20,
    params: {
      system_tool_type: "end_call",
    },
  };

  const payload = {
    conversation_config: {
      agent: {
        prompt: {
          tool_ids: newToolIds,
          built_in_tools: newBuiltIn,
        },
      },
    },
  };

  console.log("\nPATCH payload:", JSON.stringify(payload, null, 2));

  const up = await fetch(
    `https://api.elevenlabs.io/v1/convai/agents/${AGENT_ID}`,
    {
      method: "PATCH",
      headers: {
        "xi-api-key": API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );
  if (!up.ok) throw new Error(`PATCH agent ${up.status}: ${await up.text()}`);
  const updated = await up.json();

  console.log("\n✅ Agent updated.");
  console.log(
    "New tool_ids:",
    updated.conversation_config?.agent?.prompt?.tool_ids
  );
  console.log(
    "New built_in_tools.end_call:",
    JSON.stringify(updated.conversation_config?.agent?.prompt?.built_in_tools?.end_call, null, 2)
  );
}

main().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
