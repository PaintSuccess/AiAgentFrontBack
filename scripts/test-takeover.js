/** Test the auto-takeover + timeout hand-back model. Reversible. */
const fs = require("fs"), path = require("path");
for (const f of [".env.local", ".env"]) { const p = path.join(__dirname, "..", f); if (!fs.existsSync(p)) continue; for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1"); } }

const q = require("../lib/comms/queries");
const { getSupabase } = require("../lib/supabase");
const PHONE = "+61400000000";
const results = [];
const ok = (n, c, d = "") => results.push([n, !!c, d]);

(async () => {
  const sb = getSupabase();
  const threadId = await q.resolveThreadId({ phone: PHONE });
  const { data: orig } = await sb.from("threads").select("control_mode, ai_paused_until").eq("id", threadId).single();

  // 1. Human takeover (auto, on send)
  const t1 = await q.humanTakeoverThread(threadId);
  ok("1 human takeover sets human + pause", t1.control_mode === "human" && !!t1.ai_paused_until);

  // 2. Inbound while human-active → AI silent
  const e1 = await q.evaluateInboundControl(PHONE);
  ok("2 AI silent during human control", e1.aiEnabled === false);

  // 3. Simulate window lapsed → next inbound auto-hands back to AI
  await sb.from("threads").update({ ai_paused_until: new Date(Date.now() - 60000).toISOString() }).eq("id", threadId);
  const e2 = await q.evaluateInboundControl(PHONE);
  ok("3 auto hand-back when window lapsed", e2.aiEnabled === true && e2.handedBack === true);
  const { data: after } = await sb.from("threads").select("control_mode, ai_paused_until").eq("id", threadId).single();
  ok("3b control reverted to ai", after.control_mode === "ai" && after.ai_paused_until === null);

  // 4. Explicit take over → silent again
  await q.setControl(threadId, "human");
  ok("4 explicit takeover → AI silent", (await q.evaluateInboundControl(PHONE)).aiEnabled === false);

  // 5. Hand back to AI → AI replies
  await q.setControl(threadId, "ai");
  ok("5 hand to AI → AI replies", (await q.evaluateInboundControl(PHONE)).aiEnabled === true);

  // restore
  await sb.from("threads").update({ control_mode: orig.control_mode, ai_paused_until: orig.ai_paused_until }).eq("id", threadId);
  ok("restore original", true);

  let pass = true;
  for (const [n, g, d] of results) { console.log(`  ${g ? "✓" : "✗"} ${n}${d ? ` [${d}]` : ""}`); if (!g) pass = false; }
  console.log(pass ? "\nPASS ✅" : "\nFAIL ❌");
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
