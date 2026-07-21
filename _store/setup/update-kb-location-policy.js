/**
 * update-kb-location-policy.js — fix the "agent won't give our location / pickup" behaviour.
 *
 * WHY (3-day call audit ending 2026-07-20): multiple callers asked for the shop/warehouse
 * location or pickup and the agent deflected ("as an AI I can't provide warehouse or office
 * location details", "not open to the public"). Root cause was NOT a missing address — the
 * Chatswood demonstration centre was already in "Excluded Products & Restrictions", but
 * gated "Mention this ONLY when the customer asks about demonstrations, trying the backpack,
 * or seeing the equipment in person." A plain "where are you / can I pick up / your address"
 * question doesn't match that trigger, so the agent fell through to the "## Sydney Warehouse
 * — not open to the public" section and deflected.
 *
 * FIX (content supplied verbatim by the client, 2026-07-21): replace the narrow "DAN'S
 * Demonstration Location" section AND the deflecting "Sydney Warehouse" section with one
 * "Demonstration Centre & Pickup Policy" section that (a) states pickup is not available and
 * all orders ship AU-wide, (b) gives the Chatswood demonstration centre for anyone asking
 * where we are / to visit / to pick up, and (c) offers 24/7 online help for non-Sydney
 * customers. Everything else in the doc is preserved byte-for-byte.
 *
 * This is a `prompt` doc (always in context), so NO RAG index is involved. But an ElevenLabs
 * text "update" is delete + recreate → a NEW doc id, so the agent's knowledge_base must be
 * re-pointed at the new id (this script does that in place, preserving order and every other
 * doc). Mirrors api/dashboard/knowledge-base.js PATCH, which we can't call from a script
 * (dashboard JWT auth).
 *
 *   node update-kb-location-policy.js            # dry run: show diff, write no changes
 *   node update-kb-location-policy.js --commit   # apply
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]]) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}
loadDotEnv(path.join(__dirname, "..", "..", ".env.local"));
loadDotEnv(path.join(__dirname, "..", "..", ".env"));

const BASE = "https://api.elevenlabs.io/v1";
const KEY = process.env.ELEVENLABS_API_KEY;
const AGENT = process.env.ELEVENLABS_AGENT_ID;
const H = { "xi-api-key": KEY };
if (!KEY || !AGENT) { console.error("ELEVENLABS_API_KEY / ELEVENLABS_AGENT_ID missing"); process.exit(1); }

const DOC_NAME = "Excluded Products & Restrictions";

// The two sections we are replacing, exactly as they exist live (verified 2026-07-21).
const OLD_BLOCK = `## DAN'S Demonstration Location

Customers interested in trying the DAN'S Airless Backpack can be directed to the official distributor location:

- Inspirations Paint Chatswood
- Cnr Pacific Hwy & Nelson St
- Chatswood NSW 2067, Australia

Mention this only when the customer asks about demonstrations, trying the backpack, or seeing the equipment in person.

## Sydney Warehouse

PaintAccess is based in Sydney and is expanding. It may operate warehouse/distribution facilities in Sydney, but the warehouse is not open to the public unless the team confirms otherwise.`;

// Client-supplied policy (straight apostrophes to match existing KB style / avoid encoding drift).
const NEW_BLOCK = `## Demonstration Centre & Pickup Policy

Order pickup is currently NOT available. All online orders are shipped directly to customers, Australia-wide.

Customers who would like to see or try our products before purchasing are welcome to visit our official Sydney Demonstration Centre:

- Inspirations Paint Chatswood
- Cnr Pacific Highway & Nelson Street
- Chatswood NSW 2067, Australia

The DAN'S Backpack Sprayer and most of the DAN'S product range are on display and available for inspection and purchase at this location. At the moment this is our only physical demonstration location in Australia. We are actively expanding our network and are looking for demonstration partners and stockists in Melbourne, Brisbane, Perth, Adelaide, and other major Australian cities.

When a customer asks where we are, for our address or location, whether they can visit us, or whether they can pick up an order:

- Explain that order pickup is not available and that all orders ship Australia-wide.
- Let them know they are welcome to visit and purchase products in person at Inspirations Paint Chatswood (address above), or place an online order for delivery.
- If the customer is not located in Sydney, offer online assistance instead: our team is available 24/7 via chat, email, phone, and social media to answer questions, provide product recommendations, videos, and technical information, and help them choose the right product.`;

function resolveDoc(kb) {
  const doc = kb.find((d) => d.name === DOC_NAME);
  if (!doc) throw new Error(`"${DOC_NAME}" is not attached to the agent`);
  return doc;
}

async function main() {
  const commit = process.argv.includes("--commit");

  const agent = await (await fetch(`${BASE}/convai/agents/${AGENT}`, { headers: H })).json();
  const prompt = agent.conversation_config?.agent?.prompt || {};
  const kb = prompt.knowledge_base || [];
  const doc = resolveDoc(kb);

  const full = await (await fetch(`${BASE}/convai/knowledge-base/${doc.id}`, { headers: H })).json();
  const oldText = full.extracted_inner_html || full.text || "";

  if (!oldText.includes(OLD_BLOCK)) {
    console.error("!! The expected sections were not found verbatim — the doc has changed.");
    console.error("   Aborting so we don't corrupt it. Re-dump the live doc and update OLD_BLOCK.");
    process.exit(1);
  }
  const newText = oldText.replace(OLD_BLOCK, NEW_BLOCK);

  console.log(`Doc: ${DOC_NAME} (${doc.usage_mode}, id=${doc.id})`);
  console.log(`  ${oldText.length} chars -> ${newText.length} chars`);
  console.log("\n--- removing ---\n" + OLD_BLOCK);
  console.log("\n--- adding ---\n" + NEW_BLOCK + "\n");

  if (doc.usage_mode !== "prompt") {
    console.error(`!! Unexpected usage_mode "${doc.usage_mode}" — this script assumes a prompt doc (no RAG index).`);
    process.exit(1);
  }

  if (!commit) { console.log("--- DRY RUN. Re-run with --commit to apply. ---"); return; }

  // Back up the old content so this is reversible.
  const backup = path.join(__dirname, `kb-backup-${doc.id}.json`);
  fs.writeFileSync(backup, JSON.stringify({ id: doc.id, name: doc.name, usage_mode: doc.usage_mode, text: oldText }, null, 2));
  console.log(`backup -> ${path.basename(backup)}`);

  // 1. Create the new doc.
  const createRes = await fetch(`${BASE}/convai/knowledge-base/text`, {
    method: "POST",
    headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify({ name: doc.name, text: newText }),
  });
  if (!createRes.ok) throw new Error(`create failed: ${createRes.status} ${(await createRes.text()).slice(0, 200)}`);
  const newId = (await createRes.json()).id;
  console.log(`created new doc: ${newId}`);

  // 2. Re-point the agent's KB at the new id, IN PLACE (preserve order + every other doc + rag).
  const nextKb = kb.map((d) =>
    d.id === doc.id ? { type: d.type || "text", id: newId, name: doc.name, usage_mode: doc.usage_mode } : d
  );
  const patchRes = await fetch(`${BASE}/convai/agents/${AGENT}`, {
    method: "PATCH",
    headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify({ conversation_config: { agent: { prompt: { knowledge_base: nextKb, rag: prompt.rag } } } }),
  });
  if (!patchRes.ok) throw new Error(`agent patch failed: ${patchRes.status} ${(await patchRes.text()).slice(0, 200)}`);

  // 3. Delete the old doc (only after the agent no longer references it).
  await fetch(`${BASE}/convai/knowledge-base/${doc.id}`, { method: "DELETE", headers: H });

  // 4. Verify live.
  const after = await (await fetch(`${BASE}/convai/agents/${AGENT}`, { headers: H })).json();
  const afterKb = after.conversation_config?.agent?.prompt?.knowledge_base || [];
  const stillOld = afterKb.some((d) => d.id === doc.id);
  const hasNew = afterKb.find((d) => d.id === newId);
  const afterDoc = await (await fetch(`${BASE}/convai/knowledge-base/${newId}`, { headers: H })).json();
  const afterText = afterDoc.extracted_inner_html || afterDoc.text || "";

  console.log("\n=== verified live ===");
  console.log(`  old id detached : ${!stillOld ? "OK" : "FAIL (still attached!)"}`);
  console.log(`  new id attached : ${hasNew ? "OK (" + hasNew.usage_mode + ")" : "FAIL"}`);
  console.log(`  KB doc count    : ${afterKb.length} (was ${kb.length})`);
  console.log(`  Chatswood addr  : ${/Inspirations Paint Chatswood/.test(afterText) ? "OK" : "FAIL"}`);
  console.log(`  pickup policy   : ${/pickup is not available|pickup is currently NOT available/i.test(afterText) ? "OK" : "FAIL"}`);
  console.log(`  old warehouse gone: ${!/not open to the public/i.test(afterText) ? "OK" : "FAIL (still present)"}`);

  const ok = !stillOld && hasNew && afterKb.length === kb.length && /Inspirations Paint Chatswood/.test(afterText) && !/not open to the public/i.test(afterText);
  if (!ok) { console.error("\n!! verification failed — check the agent KB."); process.exit(1); }
  console.log("\nDone. Location/pickup questions now answer with the Chatswood demonstration centre.");
}

main().catch((e) => { console.error("\nError:", e.message); process.exit(1); });
