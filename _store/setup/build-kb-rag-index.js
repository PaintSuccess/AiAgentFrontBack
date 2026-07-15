/**
 * build-kb-rag-index.js — compute RAG embeddings for the agent's knowledge base.
 *
 * WHY
 * ---
 * Found 2026-07-15: rag.enabled was true, but EVERY attached KB doc returned
 * {"indexes":[]} — nothing had ever been indexed. The four `auto` docs (61,049 chars)
 * are only reachable via RAG, and they exceed rag.max_documents_length (50,000), so they
 * cannot be stuffed into context either. Net effect: the agent had never seen 61k chars
 * of its own knowledge base, including the whole "## DAN'S Spray / DAN'S Paint Spray"
 * section in Product Recommendation Details, the 30k sprayer troubleshooting guide, and
 * the paint-calculation logic.
 *
 * Worse, the always-loaded Product Recommendation Rules says:
 *     "DAN'S Spray, Dance Spray, DAN'S paint spray -> use Product Recommendation Details."
 * i.e. it points the agent at a document it cannot reach. That is why "DAN'S sprayer"
 * questions fell back to guessing, and part of why the codebase grew regex/product-search
 * workarounds to compensate.
 *
 * `prompt` docs are always in context and do not need an index; only `auto` docs do.
 * Indexing is additive and non-destructive — it computes embeddings, it does not alter
 * document content. Safe to re-run; already-indexed docs are skipped.
 *
 *   node build-kb-rag-index.js            # dry run — show what would be indexed
 *   node build-kb-rag-index.js --commit   # build
 *   node build-kb-rag-index.js --status   # just report current index state
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
loadDotEnv(path.join(__dirname, ".env"));

const BASE = "https://api.elevenlabs.io/v1";
const API_KEY = process.env.ELEVENLABS_API_KEY;
const AGENT_ID = process.env.ELEVENLABS_AGENT_ID;
if (!API_KEY || !AGENT_ID) {
  console.error("ELEVENLABS_API_KEY / ELEVENLABS_AGENT_ID must be set (app/.env.local).");
  process.exit(1);
}
const headers = { "xi-api-key": API_KEY };

async function agentKb() {
  const r = await fetch(`${BASE}/convai/agents/${AGENT_ID}`, { headers });
  if (!r.ok) throw new Error(`GET agent failed: ${r.status}`);
  const a = await r.json();
  const p = a.conversation_config?.agent?.prompt || {};
  return { kb: p.knowledge_base || [], rag: p.rag || {} };
}

async function indexState(id) {
  const r = await fetch(`${BASE}/convai/knowledge-base/${id}/rag-index`, { headers });
  if (!r.ok) return { error: `HTTP ${r.status}` };
  return r.json();
}

async function buildIndex(id, model) {
  const r = await fetch(`${BASE}/convai/knowledge-base/${id}/rag-index`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
  });
  const body = await r.text();
  return { ok: r.ok, status: r.status, body: body.slice(0, 240) };
}

async function main() {
  const commit = process.argv.includes("--commit");
  const statusOnly = process.argv.includes("--status");

  const { kb, rag } = await agentKb();
  const model = rag.embedding_model || "e5_mistral_7b_instruct";
  console.log(`rag.enabled=${rag.enabled}  embedding_model=${model}  max_documents_length=${rag.max_documents_length}\n`);

  const rows = [];
  for (const d of kb) {
    const st = await indexState(d.id);
    const idx = (st.indexes || []).map((i) => `${i.model}:${i.status}`).join(", ") || "(none)";
    rows.push({ ...d, idx, indexes: st.indexes || [] });
    console.log(`  ${String(d.usage_mode).padEnd(7)} ${d.name.slice(0, 46).padEnd(46)} ${idx}`);
  }
  if (statusOnly) return;

  // Only `auto` docs are retrieved via RAG; `prompt` docs are always in context.
  const need = rows.filter((r) => r.usage_mode === "auto" && !r.indexes.some((i) => i.model === model));
  console.log(`\n${need.length} auto doc(s) need an index: ${need.map((n) => n.name).join(", ") || "(none)"}`);
  if (!need.length) { console.log("Nothing to do."); return; }

  if (!commit) {
    console.log("\n--- DRY RUN. Re-run with --commit to build. ---");
    console.log("Indexing is additive: it computes embeddings and does not modify document content.");
    return;
  }

  for (const d of need) {
    process.stdout.write(`  indexing ${d.name} ... `);
    const res = await buildIndex(d.id, model);
    console.log(res.ok ? "started" : `FAILED ${res.status} ${res.body}`);
  }

  console.log("\nre-checking index state (embedding runs async — may show 'created'/'processing'):");
  for (const d of need) {
    const st = await indexState(d.id);
    const idx = (st.indexes || []).map((i) => `${i.model}:${i.status}`).join(", ") || "(none)";
    console.log(`  ${d.name.slice(0, 46).padEnd(46)} ${idx}`);
  }
  console.log("\nRe-run with --status in a minute to confirm every auto doc reaches 'succeeded'.");
}

main().catch((err) => {
  console.error("\nError:", err.message);
  process.exit(1);
});
