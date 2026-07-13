/** Inspect real ElevenLabs call conversations + Twilio call logs to locate the
 *  customer phone number, transcript, and recording fields. Read-only. */
const fs = require("fs"), path = require("path");
for (const f of [".env.local", ".env"]) { const p = path.join(__dirname, "..", f); if (!fs.existsSync(p)) continue; for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1"); } }

const XI = process.env.ELEVENLABS_API_KEY, AGENT = process.env.ELEVENLABS_AGENT_ID;
const SID = process.env.TWILIO_ACCOUNT_SID, TOK = process.env.TWILIO_AUTH_TOKEN;

async function elList() {
  const u = new URL("https://api.elevenlabs.io/v1/convai/conversations");
  u.searchParams.set("agent_id", AGENT); u.searchParams.set("page_size", "100");
  const r = await fetch(u, { headers: { "xi-api-key": XI } });
  return (await r.json()).conversations || [];
}
async function elDetail(id) {
  const r = await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${id}`, { headers: { "xi-api-key": XI } });
  return r.ok ? r.json() : null;
}

(async () => {
  console.log("=== ElevenLabs: scanning for CALL conversations ===");
  const list = await elList();
  console.log(`list size: ${list.length}`);
  // show what the list item looks like
  console.log("sample list item keys:", Object.keys(list[0] || {}).join(", "));
  console.log("sample list item:", JSON.stringify(list[0] || {}, null, 1).slice(0, 400));

  let shown = 0;
  for (const c of list) {
    if (shown >= 3) break;
    const d = await elDetail(c.conversation_id);
    if (!d) continue;
    const md = d.metadata || {};
    const src = d.conversation_initiation_source || md.conversation_initiation_source;
    const phoneCall = md.phone_call || md.twilio || md.call;
    const isCall = phoneCall || String(src || "").toLowerCase().includes("phone") || String(src || "").toLowerCase().includes("twilio");
    if (!isCall) continue;
    shown++;
    console.log(`\n--- CALL conversation ${c.conversation_id} ---`);
    console.log("source:", src);
    console.log("metadata keys:", Object.keys(md).join(", "));
    console.log("metadata.phone_call:", JSON.stringify(phoneCall || null));
    console.log("dyn vars:", JSON.stringify(d.conversation_initiation_client_data?.dynamic_variables || {}).slice(0, 300));
    console.log("has_audio/recording keys:", Object.keys(d).filter((k) => /audio|record/i.test(k)).join(",") || "(none at top)");
    console.log("transcript turns:", (d.transcript || []).length);
    console.log("summary:", (d.analysis?.transcript_summary || "").slice(0, 80));
  }
  if (!shown) console.log("No phone-call conversations found in this page.");

  console.log("\n=== Twilio: recent Calls ===");
  const auth = Buffer.from(`${SID}:${TOK}`).toString("base64");
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Calls.json?PageSize=5`, { headers: { Authorization: `Basic ${auth}` } });
  const cd = await r.json();
  for (const call of (cd.calls || []).slice(0, 5)) {
    console.log(`- sid=${call.sid} from=${call.from} to=${call.to} dir=${call.direction} status=${call.status} dur=${call.duration}s start=${call.start_time}`);
  }
})().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
