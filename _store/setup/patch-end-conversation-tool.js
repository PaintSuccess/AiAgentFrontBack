/**
 * Patches the end_conversation tool description on ElevenLabs.
 * Run: node setup/patch-end-conversation-tool.js
 */
import "dotenv/config";

const API_KEY = process.env.ELEVENLABS_API_KEY;
const TOOL_ID = "tool_6401ks1rm2bdebdb9v06dtngq504"; // created by add-end-conversation-tool.js

const patch = {
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
  console.log(`Patching tool ${TOOL_ID}…`);
  const res = await fetch(`https://api.elevenlabs.io/v1/convai/tools/${TOOL_ID}`, {
    method: "PATCH",
    headers: { "xi-api-key": API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed: ${res.status} ${err}`);
  }

  const data = await res.json();
  console.log("✅ Tool updated:", data.id);
}

run().catch((err) => {
  console.error("❌", err.message);
  process.exit(1);
});
