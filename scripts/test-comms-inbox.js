/**
 * Smoke test for the Phase 2 read/control layer: seed a thread, list it,
 * load it, take over, verify the gate signal, clean up.
 *   node scripts/test-comms-inbox.js
 */
const fs = require("fs");
const path = require("path");

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    if (process.env[m[1]] === undefined)
      process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  }
}
loadEnvFile(path.join(__dirname, "..", ".env.local"));
loadEnvFile(path.join(__dirname, "..", ".env"));

const store = require("../lib/comms/store");
const queries = require("../lib/comms/queries");
const { getSupabase } = require("../lib/supabase");

const PHONE = "+61400000288";

(async () => {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");

  console.log("1) seed inbound...");
  const seeded = await store.recordInbound({
    channel: "whatsapp",
    fromPhone: PHONE,
    name: "Inbox Test",
    body: "Do you deliver to 2000?",
    externalProvider: "twilio",
    externalId: `WAtest${Date.now()}`,
  });
  const threadId = seeded.thread.id;

  console.log("2) listThreads (search)...");
  const { items } = await queries.listThreads({ q: "Inbox Test" });
  const inList = items.find((t) => t.id === threadId);
  console.log("   found in list:", !!inList, "| contact:", inList?.contact?.name);

  console.log("3) getThread...");
  const detail = await queries.getThread(threadId);
  console.log("   messages:", detail.messages.length, "| control:", detail.thread.control_mode);

  console.log("4) getControlByPhone (before takeover)...");
  const before = await queries.getControlByPhone(PHONE);
  console.log("   mode:", before?.control_mode);

  console.log("5) setControl -> human (takeover)...");
  await queries.setControl(threadId, "human");

  console.log("6) getControlByPhone (after takeover)...");
  const after = await queries.getControlByPhone(PHONE);
  console.log("   mode:", after?.control_mode);

  const pass =
    !!inList &&
    detail.messages.length === 1 &&
    before?.control_mode === "ai" &&
    after?.control_mode === "human";

  console.log("7) cleanup...");
  await sb.from("contacts").delete().eq("id", seeded.contact.id);

  console.log(pass ? "\nPASS ✅" : "\nFAIL ❌");
  process.exit(pass ? 0 : 1);
})().catch((err) => {
  console.error("\nERROR:", err.message);
  process.exit(1);
});
