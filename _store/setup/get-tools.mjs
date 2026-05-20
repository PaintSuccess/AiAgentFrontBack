import 'dotenv/config';
const key = process.env.ELEVENLABS_API_KEY;
const id = process.env.ELEVENLABS_AGENT_ID;
const r = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${id}`, { headers: { 'xi-api-key': key } });
const d = await r.json();
for (const t of (d.conversation_config?.agent?.tools || [])) {
  console.log(t.id, '|', t.tool_config?.name);
  console.log('  desc:', (t.tool_config?.description||'').slice(0,120));
}
