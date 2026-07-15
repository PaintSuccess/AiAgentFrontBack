/**
 * set-channel-llm.js — allow the LLM to be chosen per conversation, so voice and text
 * can run different models.
 *
 * WHY
 * ---
 * The agent has ONE llm (claude-haiku-4-5) serving every channel. That is the right
 * trade for VOICE: a phone caller hears every second of thinking. It is the wrong trade
 * for TEXT: SMS/WhatsApp turns run to an 11-14s budget, which fits a stronger model
 * comfortably, and a chunk of "the AI is being dumb" is plain model capability.
 *
 * ElevenLabs gates per-conversation overrides with an allowlist. Out of the box
 * `agent.prompt.llm` is false, so lib/elevenlabs-text.js can ASK for a different model
 * and be **silently ignored**. This flips that one flag to true. It changes no model by
 * itself — the actual choice is the TEXT_CHANNEL_LLM env var, so it can be changed or
 * reverted without a deploy.
 *
 *   node set-channel-llm.js            # dry run — show current allowlist
 *   node set-channel-llm.js --commit   # allow per-conversation llm override
 *   node set-channel-llm.js --revert   # disallow it again (back to agent default)
 *   node set-channel-llm.js --models   # print the llm ids ElevenLabs accepts
 *
 * THEN, to actually use it:
 *   vercel env add TEXT_CHANNEL_LLM production   # e.g. claude-sonnet-4-6
 *   vercel --prod                                # env vars only bind at deploy time
 * To revert: remove TEXT_CHANNEL_LLM and redeploy. Voice is untouched either way.
 *
 * NOTE: "claude-sonnet-5" does NOT exist on ConvAI. Newest Sonnet available is
 * claude-sonnet-4-6 (also claude-opus-4-7). Run --models to confirm before setting.
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

async function getAgent() {
  const r = await fetch(`${BASE}/convai/agents/${AGENT_ID}`, { headers });
  if (!r.ok) throw new Error(`GET agent failed: ${r.status}`);
  return r.json();
}

async function setLlmOverride(allowed) {
  const agent = await getAgent();
  const ov = agent.platform_settings?.overrides?.conversation_config_override || {};
  // Merge — never clobber the rest of the allowlist.
  const next = {
    ...ov,
    agent: {
      ...(ov.agent || {}),
      prompt: { ...(ov.agent?.prompt || {}), llm: allowed },
    },
  };
  const r = await fetch(`${BASE}/convai/agents/${AGENT_ID}`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      platform_settings: {
        overrides: {
          ...(agent.platform_settings?.overrides || {}),
          conversation_config_override: next,
        },
      },
    }),
  });
  if (!r.ok) throw new Error(`PATCH failed: ${r.status} ${(await r.text()).slice(0, 300)}`);
}

async function main() {
  if (process.argv.includes("--models")) {
    const r = await fetch(`${BASE}/convai/llm-usage/calculate`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt_length: 1000, number_of_pages: 0, rag_enabled: true }),
    });
    const j = await r.json();
    const all = (j.llm_prices || []).map((x) => x.llm);
    console.log("Anthropic models ConvAI accepts:");
    for (const m of all.filter((m) => /claude/i.test(m))) console.log("  " + m);
    return;
  }

  const commit = process.argv.includes("--commit");
  const revert = process.argv.includes("--revert");

  const before = await getAgent();
  const cur = before.platform_settings?.overrides?.conversation_config_override?.agent?.prompt?.llm;
  console.log(`agent llm (default, governs voice) : ${before.conversation_config?.agent?.prompt?.llm}`);
  console.log(`per-conversation llm override      : ${cur}`);
  console.log(`TEXT_CHANNEL_LLM (this shell)      : ${process.env.TEXT_CHANNEL_LLM || "(unset -> no override sent)"}`);

  if (!commit && !revert) {
    console.log("\n--- DRY RUN. --commit to allow the override, --revert to disallow. ---");
    return;
  }

  await setLlmOverride(commit ? true : false);
  const after = await getAgent();
  const now = after.platform_settings?.overrides?.conversation_config_override?.agent?.prompt?.llm;
  console.log(`\nper-conversation llm override is now: ${now}`);
  if (now !== (commit ? true : false)) {
    console.error("!! did not persist — the API may have dropped it.");
    process.exit(1);
  }
  console.log(
    commit
      ? "\nText channels may now request their own model via TEXT_CHANNEL_LLM.\nVoice still uses the agent default. Set the env var + redeploy to take effect."
      : "\nReverted: every channel is back on the agent default model."
  );
}

main().catch((err) => {
  console.error("\nError:", err.message);
  process.exit(1);
});
