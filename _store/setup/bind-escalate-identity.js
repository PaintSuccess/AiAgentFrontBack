/**
 * bind-escalate-identity.js — make escalate_to_human fill the caller's identity from
 * the conversation instead of hoping the model passes it.
 *
 * WHY (real calls, 3-day audit ending 2026-07-20):
 *
 *   conv_6401 / conv_0401 (+61401772601, a PHONE call, twice):
 *     user: "Speak to a person, please."
 *     agent -> escalate_to_human {"channel":"phone"}            <- customer_phone omitted
 *       handoff.js: isPhoneCall = (channel==="voice") && Boolean(toE164)
 *                 = false  (no phone) -> returns the WIDGET message
 *                 "tap this link on your screen: https://wa.me/..."
 *     ...but a phone call has NO screen, and the URL must not be read aloud, so the
 *     caller gets nothing. The agent then tries send_sms_notification and (until the
 *     wa.me allowlist fix) got HTTP 400. Net result, in the customer's words:
 *       "It's the same number I keep calling, and I keep getting you, not a person."
 *
 * The tool description already says "Always pass customer_phone ... Required on voice
 * calls." The model didn't. Asking the prompt more firmly is not a fix: the handoff's
 * entire delivery path hinges on a number the model keeps forgetting.
 *
 * ElevenLabs can bind a tool parameter to a dynamic variable (`dynamic_variable` on the
 * property) so the runtime fills it from conversation context and the model cannot omit
 * it. customer_phone / customer_email are supplied as dynamic variables on EVERY channel
 * (phone webhook baseDynamicVariables, the widget, and elevenlabs-text.js for SMS/
 * WhatsApp), so binding is safe everywhere:
 *   • phone  -> {{customer_phone}} = caller number -> isPhoneCall true -> texts the link
 *   • widget -> {{customer_phone}} = ""            -> isPhoneCall false -> link on screen
 *   • sms/wa -> {{customer_phone}} = their number  -> link rides in message; staff paged
 *
 * This is the SAME mechanism already live on lookup_order (bind-lookup-order-identity.js),
 * which has bound customer_phone/email/id in production without incident. Changes NO
 * backend logic — api/comms/escalate.js already reads body.customer_phone/customer_email.
 *
 *   node bind-escalate-identity.js            # dry run
 *   node bind-escalate-identity.js --commit   # apply
 *   node bind-escalate-identity.js --revert   # unbind (back to model-supplied)
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
const headers = { "xi-api-key": process.env.ELEVENLABS_API_KEY };
if (!process.env.ELEVENLABS_API_KEY) { console.error("ELEVENLABS_API_KEY missing"); process.exit(1); }

// property -> dynamic variable that should fill it. (escalate_to_human has no
// customer_id param; channel/reason/preferred_method stay model-supplied.)
const BINDINGS = {
  customer_phone: "customer_phone",
  customer_email: "customer_email",
};

const TOOL_NAME = "escalate_to_human";

/**
 * Return the escalate_to_human tool ACTUALLY ATTACHED to this agent. Selecting by name
 * alone is unsafe: the workspace accumulates orphaned duplicates, and patching an orphan
 * would report success while the live agent stayed unbound — the worst failure mode.
 * (Same guard as bind-lookup-order-identity.js.)
 */
async function getTool() {
  const agentId = process.env.ELEVENLABS_AGENT_ID;
  if (!agentId) throw new Error("ELEVENLABS_AGENT_ID missing");

  const ar = await fetch(`${BASE}/convai/agents/${agentId}`, { headers });
  if (!ar.ok) throw new Error(`get agent failed: ${ar.status}`);
  const attachedIds = (await ar.json()).conversation_config?.agent?.prompt?.tool_ids || [];
  if (!attachedIds.length) throw new Error("agent has no attached tool_ids");

  const r = await fetch(`${BASE}/convai/tools`, { headers });
  if (!r.ok) throw new Error(`list tools failed: ${r.status}`);
  const tools = (await r.json()).tools || [];

  const named = tools.filter((x) => (x.tool_config?.name || x.name) === TOOL_NAME);
  const attached = named.filter((x) => attachedIds.includes(x.id));

  if (!attached.length) {
    throw new Error(`no ${TOOL_NAME} tool is attached to ${agentId} (${named.length} exist in the workspace but none are attached)`);
  }
  if (attached.length > 1) {
    throw new Error(`ambiguous: ${attached.length} attached tools named ${TOOL_NAME} (${attached.map((x) => x.id).join(", ")})`);
  }
  if (named.length > attached.length) {
    console.log(`  note: ${named.length - attached.length} orphaned ${TOOL_NAME} tool(s) in the workspace are being ignored`);
  }
  return attached[0];
}

async function main() {
  const commit = process.argv.includes("--commit");
  const revert = process.argv.includes("--revert");

  const tool = await getTool();
  const cfg = tool.tool_config;
  const props = cfg.api_schema?.request_body_schema?.properties || {};

  console.log(`${TOOL_NAME} parameter bindings:`);
  for (const [prop, dv] of Object.entries(BINDINGS)) {
    if (!props[prop]) { console.log(`  ${prop.padEnd(15)} (not in schema — skipping)`); continue; }
    console.log(`  ${prop.padEnd(15)} dynamic_variable: ${JSON.stringify(props[prop].dynamic_variable)} -> ${JSON.stringify(revert ? "" : dv)}`);
  }
  if (!commit && !revert) { console.log("\n--- DRY RUN. --commit to apply, --revert to undo. ---"); return; }

  // The API rejects a property that carries both a description and a dynamic_variable, so
  // a bound parameter loses its prompt-facing description. Keep the originals on disk so
  // --revert restores them exactly.
  const BACKUP = path.join(__dirname, "escalate-identity-backup.json");

  const nextProps = { ...props };
  if (revert) {
    if (!fs.existsSync(BACKUP)) throw new Error(`no backup at ${BACKUP} — cannot restore descriptions`);
    const saved = JSON.parse(fs.readFileSync(BACKUP, "utf8"));
    for (const prop of Object.keys(BINDINGS)) {
      if (saved[prop]) nextProps[prop] = saved[prop];
    }
  } else {
    const saved = {};
    for (const [prop, dv] of Object.entries(BINDINGS)) {
      if (!nextProps[prop]) continue;
      saved[prop] = nextProps[prop];
      nextProps[prop] = { type: nextProps[prop].type || "string", dynamic_variable: dv };
    }
    fs.writeFileSync(BACKUP, JSON.stringify(saved, null, 2));
    console.log(`\noriginal properties saved -> ${path.basename(BACKUP)} (needed by --revert)`);
  }

  const body = {
    tool_config: {
      ...cfg,
      api_schema: {
        ...cfg.api_schema,
        request_body_schema: { ...cfg.api_schema.request_body_schema, properties: nextProps },
      },
    },
  };

  const r = await fetch(`${BASE}/convai/tools/${tool.id}`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`PATCH failed: ${r.status} ${(await r.text()).slice(0, 300)}`);

  const after = await getTool();
  const ap = after.tool_config?.api_schema?.request_body_schema?.properties || {};
  console.log("\n=== verified live ===");
  let ok = true;
  for (const [prop, dv] of Object.entries(BINDINGS)) {
    if (!ap[prop]) continue;
    const want = revert ? "" : dv;
    const got = ap[prop].dynamic_variable;
    if (got !== want) ok = false;
    console.log(`  ${got === want ? "OK  " : "FAIL"} ${prop.padEnd(15)} -> ${JSON.stringify(got)}`);
  }
  if (!ok) { console.error("\n!! did not persist — the API may have dropped it."); process.exit(1); }
  console.log(revert ? "\nUnbound: the model must supply identity again." : "\nBound: the runtime now fills the caller's phone/email; the model cannot omit it on a call.");
}

main().catch((e) => { console.error("\nError:", e.message); process.exit(1); });
