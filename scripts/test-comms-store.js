/**
 * Smoke test for the comms store: inbound → outbound → status → read → cleanup.
 *   node scripts/test-comms-store.js
 */
const fs = require("fs");
const path = require("path");

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const key = m[1];
    const val = m[2].trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadEnvFile(path.join(__dirname, "..", ".env.local"));
loadEnvFile(path.join(__dirname, "..", ".env"));

const store = require("../lib/comms/store");
const { getSupabase } = require("../lib/supabase");

const TEST_PHONE = "+61400000199";
const SID = `SMtest${Date.now()}`;

(async () => {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured (check .env.local)");

  console.log("1) inbound...");
  const inbound = await store.recordInbound({
    channel: "sms",
    fromPhone: TEST_PHONE,
    name: "Test Customer",
    body: "Hi, is the airless sprayer in stock?",
    externalProvider: "twilio",
    externalId: `${SID}-in`,
  });
  console.log("   contact:", inbound?.contact?.id, "thread:", inbound?.thread?.id);

  console.log("2) inbound again (idempotency: same provider id)...");
  await store.recordInbound({
    channel: "sms",
    fromPhone: TEST_PHONE,
    body: "Hi, is the airless sprayer in stock?",
    externalProvider: "twilio",
    externalId: `${SID}-in`,
  });

  console.log("3) outbound reply...");
  await store.recordOutbound({
    channel: "sms",
    toPhone: TEST_PHONE,
    author: "ai",
    body: "Yes! The Graco 495 is in stock and ready to ship.",
    externalProvider: "twilio",
    externalId: `${SID}-out`,
    status: "sent",
  });

  console.log("4) status update (delivered)...");
  await store.recordStatus({
    externalProvider: "twilio",
    externalId: `${SID}-out`,
    status: "delivered",
  });

  console.log("5) read back...");
  const { data: contact } = await sb
    .from("contacts")
    .select("*")
    .eq("phone", TEST_PHONE)
    .single();
  const { data: thread } = await sb
    .from("threads")
    .select("*")
    .eq("contact_id", contact.id)
    .single();
  const { data: messages } = await sb
    .from("messages")
    .select("channel,direction,author,body,status,external_id")
    .eq("thread_id", thread.id)
    .order("sent_at", { ascending: true });
  const { count: eventCount } = await sb
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("contact_id", contact.id);

  console.log("   thread unread:", thread.unread_count, "| last:", thread.last_message_preview);
  console.log("   messages:", messages.length);
  messages.forEach((m) =>
    console.log(`     [${m.direction}/${m.author}] ${m.status} — ${m.body?.slice(0, 40)}`)
  );
  console.log("   events:", eventCount);

  const pass =
    messages.length === 2 &&
    messages.find((m) => m.direction === "outbound")?.status === "delivered" &&
    thread.unread_count === 1;

  console.log("6) cleanup...");
  await sb.from("contacts").delete().eq("id", contact.id); // cascades

  console.log(pass ? "\nPASS ✅" : "\nFAIL ❌ (unexpected state)");
  process.exit(pass ? 0 : 1);
})().catch((err) => {
  console.error("\nERROR:", err.message);
  process.exit(1);
});
