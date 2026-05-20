import "dotenv/config";

const API_KEY = process.env.ELEVENLABS_API_KEY;
const AGENT_ID = process.env.ELEVENLABS_AGENT_ID;

async function verify() {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/convai/agents/${AGENT_ID}`,
    { headers: { "xi-api-key": API_KEY } }
  );
  const agent = await res.json();
  const config = agent.conversation_config || {};
  
  console.log("Agent:", agent.name);
  console.log("Voice:", config.tts?.voice_id);
  console.log("Language:", config.agent?.language);
  console.log("\nFirst Message:", config.agent?.first_message);
  console.log("\nPrompt (first 200 chars):", config.agent?.prompt?.prompt?.substring(0, 200));
  
  // Check tools in different locations
  console.log("\n--- Tools ---");
  console.log("config.tools:", JSON.stringify(config.tools, null, 2)?.substring(0, 500));
  
  // Check if tools are in workflow
  if (agent.workflow) {
    console.log("\nWorkflow nodes:", agent.workflow.nodes?.length);
    const toolNodes = (agent.workflow?.nodes || []).filter(n => n.type === "tool" || n.data?.tool);
    console.log("Tool nodes:", toolNodes.length);
    if (toolNodes.length > 0) {
      for (const tn of toolNodes) {
        console.log(`  - ${tn.data?.name || tn.id} (${tn.type})`);
      }
    }
  }
  
  // Dump full config keys
  console.log("\nTop-level keys:", Object.keys(agent));
  console.log("conversation_config keys:", Object.keys(config));
}

verify().catch(e => console.error(e.message));
