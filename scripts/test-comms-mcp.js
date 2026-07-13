/**
 * Smoke test for the Phase 4 MCP comms tool handlers (read/control only — does
 * NOT call comms_send_message, which would send a real message).
 *   node scripts/test-comms-mcp.js
 */
const fs = require("fs");
const path = require("path");
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && process.env[m[1]] === undefined)
      process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  }
}
loadEnvFile(path.join(__dirname, "..", ".env.local"));
loadEnvFile(path.join(__dirname, "..", ".env"));

const store = require("../lib/comms/store");
const mcp = require("../lib/comms/mcp-tools");
const { getSupabase } = require("../lib/supabase");

const PHONE = "+61400000377";

(async () => {
  const sb = getSupabase();
  const seeded = await store.recordInbound({
    channel: "sms",
    fromPhone: PHONE,
    name: "MCP Test",
    body: "What is the price of the Graco 390?",
    externalProvider: "twilio",
    externalId: `SMmcp${Date.now()}`,
  });

  console.log("1) comms_search_threads...");
  const search = await mcp.commsSearchThreads({ query: "MCP Test" });
  const hit = search.threads.find((t) => t.thread_id === seeded.thread.id);
  console.log("   found:", !!hit, "| control:", hit?.control_mode);

  console.log("2) comms_get_thread by phone...");
  const detail = await mcp.commsGetThread({ phone: PHONE });
  console.log("   messages:", detail.messages.length, "| first:", detail.messages[0]?.body?.slice(0, 30));

  console.log("3) comms_take_over by phone...");
  const took = await mcp.commsTakeOver({ phone: PHONE });
  console.log("   control:", took.control_mode);

  console.log("4) comms_hand_back by thread_id...");
  const back = await mcp.commsHandBack({ thread_id: seeded.thread.id });
  console.log("   control:", back.control_mode);

  const pass =
    !!hit &&
    detail.messages.length === 1 &&
    took.control_mode === "human" &&
    back.control_mode === "ai";

  console.log("5) cleanup...");
  await sb.from("contacts").delete().eq("id", seeded.contact.id);
  console.log(pass ? "\nPASS ✅" : "\nFAIL ❌");
  process.exit(pass ? 0 : 1);
})().catch((err) => {
  console.error("\nERROR:", err.message);
  process.exit(1);
});
