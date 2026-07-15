/**
 * tune-voice-stack.js — voice-stack fixes from the 2026-07-15 call-quality investigation.
 *
 * WHY THIS EXISTS AS ITS OWN SCRIPT
 * ---------------------------------
 * update-agent.js rewrites the whole system prompt. These are ASR/turn/RAG settings that
 * are unrelated to the prompt and need to be revertible on their own — the whole point is
 * that we can undo ONE of them if it doesn't help, without disturbing anything else.
 *
 * Every run snapshots the live "before" values to _store/setup/voice-stack-backups/ so
 * any change here can be reverted exactly. Nothing is destructive.
 *
 *   node tune-voice-stack.js            # dry run — prints the diff, changes nothing
 *   node tune-voice-stack.js --commit   # apply
 *   node tune-voice-stack.js --revert <backup.json>
 *
 * WHAT IT CHANGES AND WHY (evidence in _store/docs/VOICE-STACK-2026-07-15.md)
 * --------------------------------------------------------------------------
 * 1. asr.keywords: []  ->  brand vocabulary
 *    Scribe had no keyword biasing, so the invented brand "DAN'S" was never recognised.
 *    Measured in real calls: "Dense", "Sponsored Defense Backpack", "Chatsworth" (our own
 *    demo suburb), "Chinese". The customer had to spell "D-A-N-apostrophe-S" out loud.
 *
 * 2. turn.turn_timeout: 7 -> 3, and soft-timeout fillers enabled
 *    The agent waited up to 7s of silence before deciding the caller had finished.
 *    Measured reply latency: median 6-8s, max 13s — the medians match the timeout almost
 *    exactly. Fillers were configured but disabled (timeout_seconds: -1), so that wait was
 *    dead silence, as were tool calls (one call had 6 silent agent turns).
 *
 * NOT CHANGED HERE — deliberately. See the doc:
 *   - agent_output_audio_format (pcm_24000 -> ulaw_8000): cannot be overridden per-call,
 *     so it would drop the WEBSITE WIDGET to 8kHz telephone audio too. And the reported
 *     volume swing does not reproduce in ElevenLabs' own recordings (agent loudness spread
 *     measured at 0.9-2.6 LU across two calls). Needs a stationary re-test first.
 *   - tts.stability / style: the measurements say the voice is stable. Don't tune what
 *     isn't broken.
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
const BACKUP_DIR = path.join(__dirname, "voice-stack-backups");

// ── 1. ASR keyword biasing ────────────────────────────────────────────────────
// Scribe boosts these terms. They are the words a generic speech model has never
// seen (invented brands, local suburbs, trade jargon) — not common English.
const ASR_KEYWORDS = [
  // The brand the customer could not get recognised, in the forms people say it.
  "DAN'S", "Dans", "Dan's Airless", "BackSprayMate",
  // Brands we stock.
  "Graco", "Mirka", "iQuip", "Taubmans", "ZipWall", "Oldfields", "Uni-Pro",
  "Dulux", "Rust-Oleum", "Zinsser", "Norglass", "Wagner", "Flood",
  // Product lines that get mangled.
  "EPOXYSHIELD", "RockSolid", "Cosmocoat", "JetRoller", "FinishPro", "TexSpray", "Magnum",
  // Trade jargon.
  "airless", "HVLP", "sprayer", "primer", "undercoat", "drop cloth",
  // Places/names that were misheard in real calls ("Chatsworth" -> Chatswood).
  "Chatswood", "Paint Access", "PaintAccess",
];

const TURN_TIMEOUT_SECONDS = 3; // was 7
const SOFT_TIMEOUT_SECONDS = 2; // was -1 (disabled) => dead air
const SOFT_TIMEOUT_MESSAGE = "One sec, just checking that for you.";

async function getAgent() {
  const r = await fetch(`${BASE}/convai/agents/${AGENT_ID}`, { headers });
  if (!r.ok) throw new Error(`GET agent failed: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

async function patchAgent(conversation_config) {
  const r = await fetch(`${BASE}/convai/agents/${AGENT_ID}`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ conversation_config }),
  });
  if (!r.ok) throw new Error(`PATCH agent failed: ${r.status} ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

function snapshot(cc) {
  return {
    savedAt: new Date().toISOString(),
    agent_id: AGENT_ID,
    note: "Pre-change snapshot. Revert with: node tune-voice-stack.js --revert <this file>",
    asr: cc.asr,
    turn: cc.turn,
  };
}

async function main() {
  const commit = process.argv.includes("--commit");
  const revertIdx = process.argv.indexOf("--revert");

  if (revertIdx !== -1) {
    const file = process.argv[revertIdx + 1];
    if (!file || !fs.existsSync(file)) {
      console.error("--revert needs a backup file from voice-stack-backups/");
      process.exit(1);
    }
    const backup = JSON.parse(fs.readFileSync(file, "utf8"));
    console.log(`Reverting asr + turn to the snapshot taken ${backup.savedAt}...`);
    await patchAgent({ asr: backup.asr, turn: backup.turn });
    const after = (await getAgent()).conversation_config;
    console.log("  asr.keywords :", JSON.stringify(after.asr?.keywords));
    console.log("  turn_timeout :", after.turn?.turn_timeout);
    console.log("Reverted.");
    return;
  }

  const agent = await getAgent();
  const cc = agent.conversation_config || {};

  const nextAsr = { ...cc.asr, keywords: ASR_KEYWORDS };
  const nextTurn = {
    ...cc.turn,
    turn_timeout: TURN_TIMEOUT_SECONDS,
    soft_timeout_config: {
      ...(cc.turn?.soft_timeout_config || {}),
      timeout_seconds: SOFT_TIMEOUT_SECONDS,
      message: SOFT_TIMEOUT_MESSAGE,
    },
  };

  console.log("=== asr.keywords ===");
  console.log(`  before: ${JSON.stringify(cc.asr?.keywords)}  (${(cc.asr?.keywords || []).length} terms)`);
  console.log(`  after : ${ASR_KEYWORDS.length} terms — ${ASR_KEYWORDS.slice(0, 6).join(", ")}, ...`);
  console.log("\n=== turn ===");
  console.log(`  turn_timeout                     : ${cc.turn?.turn_timeout} -> ${TURN_TIMEOUT_SECONDS}`);
  console.log(`  soft_timeout_config.timeout_secs : ${cc.turn?.soft_timeout_config?.timeout_seconds} -> ${SOFT_TIMEOUT_SECONDS}`);
  console.log(`  soft_timeout_config.message      : ${JSON.stringify(cc.turn?.soft_timeout_config?.message)} -> ${JSON.stringify(SOFT_TIMEOUT_MESSAGE)}`);

  if (!commit) {
    console.log("\n--- DRY RUN. Re-run with --commit to apply. ---");
    return;
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const backupFile = path.join(BACKUP_DIR, `before-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(snapshot(cc), null, 2));
  console.log(`\nsnapshot saved -> ${path.relative(process.cwd(), backupFile)}`);

  await patchAgent({ asr: nextAsr, turn: nextTurn });

  const after = (await getAgent()).conversation_config;
  const okKeywords = (after.asr?.keywords || []).length === ASR_KEYWORDS.length;
  const okTurn = after.turn?.turn_timeout === TURN_TIMEOUT_SECONDS;
  const okSoft = after.turn?.soft_timeout_config?.timeout_seconds === SOFT_TIMEOUT_SECONDS;
  console.log("\n=== verified live ===");
  console.log(`  ${okKeywords ? "OK  " : "FAIL"} asr.keywords now ${(after.asr?.keywords || []).length} terms`);
  console.log(`  ${okTurn ? "OK  " : "FAIL"} turn_timeout now ${after.turn?.turn_timeout}`);
  console.log(`  ${okSoft ? "OK  " : "FAIL"} soft timeout now ${after.turn?.soft_timeout_config?.timeout_seconds}s`);
  if (!okKeywords || !okTurn || !okSoft) {
    console.error("\n!! Something did not persist — the API may silently drop unsupported fields.");
    console.error(`   Revert with: node tune-voice-stack.js --revert "${backupFile}"`);
    process.exit(1);
  }
  console.log(`\nTo undo: node tune-voice-stack.js --revert "${path.relative(process.cwd(), backupFile)}"`);
}

main().catch((err) => {
  console.error("\nError:", err.message);
  process.exit(1);
});
