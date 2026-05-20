// sync-kb.js — Sync ElevenLabs knowledge base documents to local /kb folder.
//
// Usage: node sync-kb.js
//
// Reads the agent's current knowledge_base config and downloads each
// attached document into ../kb/<slug>__<mode>.md so we always have a
// source-of-truth local copy of what the agent is actually using.
//
// Also reports any orphan documents (in the KB library but not attached
// to the agent) — these can pile up and confuse the editor UI.

import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://api.elevenlabs.io/v1";
const KEY = process.env.ELEVENLABS_API_KEY;
const AGENT = process.env.ELEVENLABS_AGENT_ID;
const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "kb");

if (!KEY || !AGENT) {
  console.error("Missing ELEVENLABS_API_KEY or ELEVENLABS_AGENT_ID in .env");
  process.exit(1);
}

function slug(s) {
  return s.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
}

async function get(path) {
  const r = await fetch(`${API}${path}`, { headers: { "xi-api-key": KEY } });
  if (!r.ok) throw new Error(`${r.status} ${path}: ${await r.text()}`);
  return r;
}

async function run() {
  mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Fetching agent ${AGENT}...`);
  const agent = await (await get(`/convai/agents/${AGENT}`)).json();
  const kb = agent?.conversation_config?.agent?.prompt?.knowledge_base || [];
  console.log(`Agent has ${kb.length} KB documents attached.\n`);

  const attachedIds = new Set();
  for (const doc of kb) {
    attachedIds.add(doc.id);
    const r = await get(`/convai/knowledge-base/${doc.id}/content`);
    const text = await r.text();
    const fname = join(OUT_DIR, `${slug(doc.name)}__${doc.usage_mode}.md`);
    writeFileSync(
      fname,
      `<!-- name: ${doc.name} | mode: ${doc.usage_mode} | id: ${doc.id} -->\n\n${text}`
    );
    console.log(`  + ${doc.name}  (${doc.usage_mode}, ${text.length} chars)`);
  }

  // Find orphan docs.
  console.log("\nChecking for orphan documents...");
  const lib = await (await get(`/convai/knowledge-base?page_size=100`)).json();
  const orphans = (lib.documents || []).filter((d) => !attachedIds.has(d.id));
  if (orphans.length === 0) {
    console.log("  None.");
  } else {
    console.log(`  Found ${orphans.length} orphan documents:`);
    for (const o of orphans) {
      console.log(`    ${o.id}  ${o.name}  (${o.metadata.size_bytes} bytes)`);
    }
    console.log("\n  Run with --delete-orphans to remove them.");
    if (process.argv.includes("--delete-orphans")) {
      for (const o of orphans) {
        const r = await fetch(`${API}/convai/knowledge-base/${o.id}`, {
          method: "DELETE",
          headers: { "xi-api-key": KEY },
        });
        console.log(`    ${r.ok ? "deleted" : "FAILED"}  ${o.id}  ${o.name}`);
      }
    }
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
