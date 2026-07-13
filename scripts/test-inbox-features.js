/** Smoke test for P1/P2 inbox features (thread state, search, contacts, canned). */
const fs = require("fs"), path = require("path");
for (const f of [".env.local", ".env"]) { const p = path.join(__dirname, "..", f); if (!fs.existsSync(p)) continue; for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1"); } }

const store = require("../lib/comms/store");
const queries = require("../lib/comms/queries");
const contactsLib = require("../lib/comms/contacts");
const canned = require("../lib/comms/canned");
const { getSupabase } = require("../lib/supabase");

const PHONE = "+61400000455";
const TERM = `zeblorptest${Date.now()}`;
const USER = "user_testsub";

(async () => {
  const sb = getSupabase();
  const seeded = await store.recordInbound({ channel: "sms", fromPhone: PHONE, name: "Feature Test", body: `hello ${TERM} sprayer`, externalProvider: "twilio", externalId: `SMf${Date.now()}` });
  const threadId = seeded.thread.id, contactId = seeded.contact.id;
  const results = [];

  await queries.setThreadFields(threadId, { starred: true, pinned: true, status: "pending", labels: ["VIP"], assigned_to: USER });
  const t = (await queries.getThread(threadId)).thread;
  results.push(["thread fields", t.starred && t.pinned && t.status === "pending" && t.labels.includes("VIP") && t.assigned_to === USER]);

  const starred = await queries.listThreads({ folder: "starred" });
  results.push(["folder starred", starred.items.some((x) => x.id === threadId)]);
  const mine = await queries.listThreads({ folder: "mine", currentUser: USER });
  results.push(["folder mine", mine.items.some((x) => x.id === threadId)]);
  const unassigned = await queries.listThreads({ folder: "unassigned" });
  results.push(["folder unassigned excludes", !unassigned.items.some((x) => x.id === threadId)]);

  const searched = await queries.listThreads({ q: TERM });
  results.push(["server search by body", searched.items.some((x) => x.id === threadId)]);
  const searchedPhone = await queries.listThreads({ q: "400000455" });
  results.push(["server search by phone", searchedPhone.items.some((x) => x.id === threadId)]);

  const counts = await queries.getInboxCounts(USER);
  results.push(["counts starred+mine", counts.starred >= 1 && counts.mine >= 1]);

  const upd = await contactsLib.updateContact(contactId, { tags: ["vip-test"], notes: "internal note" });
  results.push(["contact update local", upd.ok && upd.shopifySynced === false]);
  const dir = await contactsLib.listContacts({ q: "Feature Test" });
  results.push(["contacts directory", dir.items.some((x) => x.id === contactId)]);

  const cr = await canned.createCanned({ title: "Test QR", body: "Thanks for reaching out!" });
  const clist = await canned.listCanned();
  results.push(["canned create+list", clist.items.some((x) => x.id === cr.id)]);
  await canned.deleteCanned(cr.id);

  await sb.from("contacts").delete().eq("id", contactId);

  let pass = true;
  for (const [name, ok] of results) { console.log(`  ${ok ? "✓" : "✗"} ${name}`); if (!ok) pass = false; }
  console.log(pass ? "\nPASS ✅" : "\nFAIL ❌");
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
