import "dotenv/config";

const API_KEY = process.env.ELEVENLABS_API_KEY;

async function listAgents() {
  console.log("Fetching all agents from ElevenLabs account...\n");

  const res = await fetch("https://api.elevenlabs.io/v1/convai/agents", {
    headers: { "xi-api-key": API_KEY },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to list agents: ${res.status} ${err}`);
  }

  const data = await res.json();
  const agents = data.agents || [];

  console.log(`Found ${agents.length} agent(s):\n`);

  for (const agent of agents) {
    console.log(`─────────────────────────────────`);
    console.log(`ID:   ${agent.agent_id}`);
    console.log(`Name: ${agent.name}`);
    console.log(`Created: ${agent.created_at || "N/A"}`);

    // Fetch full agent details
    const detailRes = await fetch(
      `https://api.elevenlabs.io/v1/convai/agents/${agent.agent_id}`,
      { headers: { "xi-api-key": API_KEY } }
    );

    if (detailRes.ok) {
      const detail = await detailRes.json();
      const config = detail.conversation_config || {};
      const agentConfig = config.agent || {};
      const prompt = agentConfig.prompt?.prompt || "N/A";
      const firstMsg = agentConfig.first_message || "N/A";
      const voice = config.tts?.voice_id || "N/A";
      const lang = agentConfig.language || "N/A";
      const tools = config.tools || [];

      console.log(`Language: ${lang}`);
      console.log(`Voice ID: ${voice}`);
      console.log(`Tools: ${tools.length > 0 ? tools.map(t => t.name).join(", ") : "none"}`);
      console.log(`\nFirst Message:\n${firstMsg}`);
      console.log(`\nSystem Prompt:\n${prompt}`);
    }
    console.log();
  }
}

listAgents().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
