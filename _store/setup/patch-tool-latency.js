// Patches the live ElevenLabs ConvAI tools to reduce perceived latency on
// product / order lookups by forcing the agent to acknowledge the request
// ("Let me check that for you...") before the webhook runs.
//
// Root cause of the ~10s gap on search_products:
//   * Backend: ~700ms (measured) — not the cause.
//   * Agent was silent during the entire wait because
//     force_pre_tool_speech=false and pre_tool_speech="auto".
//   * Response payload was 11KB (15 products × 5 variants each) → big LLM
//     ingest time on gemini-2.5-flash.  Shrunk separately in products.js.
//
// What this script changes (via PATCH /v1/convai/tools/{id}):
//   search_products, lookup_order:
//     - force_pre_tool_speech: true       (agent MUST speak a filler first)
//     - pre_tool_speech:        "force"   (was "auto")
//     - tool_call_sound_behavior: "with_pre_speech"  (audio while waiting)
//     - tool_call_sound: "typing"         (already set, kept for safety)
//
// Run:  node setup/patch-tool-latency.js
import "dotenv/config";

const API_KEY = process.env.ELEVENLABS_API_KEY;
const AGENT_ID = process.env.ELEVENLABS_AGENT_ID;

if (!API_KEY || !AGENT_ID) {
  console.error("Missing ELEVENLABS_API_KEY or ELEVENLABS_AGENT_ID in setup/.env");
  process.exit(1);
}

const HEADERS = { "xi-api-key": API_KEY, "Content-Type": "application/json" };

// Tool names to patch. Both involve external lookups slow enough to need
// pre-speech.  Email is excluded (user doesn't wait for it conversationally).
const TARGET_NAMES = new Set(["search_products", "lookup_order"]);

// API enum (verified via 422 response 2025):
//   tool_call_sound_behavior:  "auto" | "always"
//     - auto   = sound only when agent speaks pre-tool
//     - always = sound on every tool call regardless
//   pre_tool_speech: "auto" | "force" | (others?)  — we'll set force_pre_tool_speech=true
//     and keep pre_tool_speech="force" if accepted, else leave "auto".
const PATCH_OVERRIDES = {
  force_pre_tool_speech: true,
  pre_tool_speech: "force",
  tool_call_sound: "typing",
  tool_call_sound_behavior: "always", // play even if LLM forgets the filler
};

async function main() {
  console.log("Fetching agent to discover tool IDs...");
  const agentRes = await fetch(
    `https://api.elevenlabs.io/v1/convai/agents/${AGENT_ID}`,
    { headers: HEADERS }
  );
  if (!agentRes.ok) {
    console.error("GET agent failed:", agentRes.status, await agentRes.text());
    process.exit(1);
  }
  const agent = await agentRes.json();
  const toolIds = agent.conversation_config?.agent?.prompt?.tool_ids || [];
  console.log(`Found ${toolIds.length} tool ids attached.`);

  for (const id of toolIds) {
    const tRes = await fetch(`https://api.elevenlabs.io/v1/convai/tools/${id}`, {
      headers: HEADERS,
    });
    if (!tRes.ok) {
      console.error(`  GET ${id} failed: ${tRes.status}`);
      continue;
    }
    const tool = await tRes.json();
    const cfg = tool.tool_config || {};
    const name = cfg.name;

    if (!TARGET_NAMES.has(name)) {
      console.log(`  · skip ${name}`);
      continue;
    }

    const newCfg = { ...cfg, ...PATCH_OVERRIDES };
    const patchRes = await fetch(
      `https://api.elevenlabs.io/v1/convai/tools/${id}`,
      {
        method: "PATCH",
        headers: HEADERS,
        body: JSON.stringify({ tool_config: newCfg }),
      }
    );
    if (!patchRes.ok) {
      console.error(`  ✗ PATCH ${name}: ${patchRes.status} ${await patchRes.text()}`);
      continue;
    }
    console.log(`  ✓ patched ${name} (id=${id})`);
  }

  // Verify
  console.log("\nVerifying live config:");
  for (const id of toolIds) {
    const tRes = await fetch(`https://api.elevenlabs.io/v1/convai/tools/${id}`, {
      headers: HEADERS,
    });
    const tool = await tRes.json();
    const c = tool.tool_config || {};
    if (!TARGET_NAMES.has(c.name)) continue;
    console.log(
      `  ${c.name}: force_pre_tool_speech=${c.force_pre_tool_speech}, pre_tool_speech=${c.pre_tool_speech}, sound=${c.tool_call_sound}/${c.tool_call_sound_behavior}`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
