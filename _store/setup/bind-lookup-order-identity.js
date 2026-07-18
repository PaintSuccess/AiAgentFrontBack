/**
 * bind-lookup-order-identity.js — make lookup_order fill identity from the conversation
 * instead of hoping the model remembers to pass it.
 *
 * WHY (real call, 2026-07-15, conv_7301kxk2qaf0fy7tzs9yzrkgr17n — a LOGGED-IN customer):
 *
 *   dynamic_variables: customer_id="8654449573991"   <- we knew who they were the whole time
 *   [74s] user: "44542"
 *   [77s] lookup_order {"order_number":"44542"}                      <- customer_id omitted
 *         -> {"found":false,"message":"For security, please send the email..."}
 *   [80s] agent: "Just to verify, can you give me the email address..."
 *   [88s] user: "I already logged in on the website. Do you need the email?"
 *   [94s] lookup_order {"order_number":"44542","customer_id":"8654449573991"}
 *         -> {"found":true,...}
 *
 * The customer had to argue with us to get their own order. The prompt already says
 * "You MUST pass customer_id ... on EVERY lookup_order call" — the model simply didn't.
 * Asking the prompt more firmly is not a fix: it leaves a security-relevant identity check
 * depending on an LLM remembering an instruction.
 *
 * ElevenLabs can bind a tool parameter to a dynamic variable (`dynamic_variable` on the
 * property), so the runtime fills it from conversation context and the model cannot omit
 * it. Identity should come from the session, not from the model's short-term memory.
 *
 * This changes NO backend logic: api/shopify/order.js already treats customer_id /
 * customer_phone as trusted context (see lookupCustomerOrder). It just guarantees they
 * arrive.
 *
 *   node bind-lookup-order-identity.js            # dry run
 *   node bind-lookup-order-identity.js --commit   # apply
 *   node bind-lookup-order-identity.js --revert   # unbind (back to model-supplied)
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

// property -> dynamic variable that should fill it
const BINDINGS = {
  customer_id: "customer_id",
  customer_email: "customer_email",
  customer_phone: "customer_phone",
};

/**
 * Return the lookup_order tool ACTUALLY ATTACHED to this agent.
 *
 * Selecting by name alone is unsafe here: create-tools.js POSTs new standalone tools on
 * every run, so the workspace accumulates duplicates (a 2026-07-15 audit found 30 tools,
 * 22 of them unattached orphans). Picking whichever the account-level list returns first
 * would happily patch an orphan and report success while the live agent stayed unbound —
 * the worst kind of failure, since it looks like it worked.
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

  const named = tools.filter((x) => (x.tool_config?.name || x.name) === "lookup_order");
  const attached = named.filter((x) => attachedIds.includes(x.id));

  if (!attached.length) {
    throw new Error(
      `no lookup_order tool is attached to ${agentId} (${named.length} exist in the workspace but none are attached)`
    );
  }
  if (attached.length > 1) {
    throw new Error(`ambiguous: ${attached.length} attached tools named lookup_order (${attached.map((x) => x.id).join(", ")})`);
  }
  if (named.length > attached.length) {
    console.log(`  note: ${named.length - attached.length} orphaned lookup_order tool(s) in the workspace are being ignored`);
  }
  return attached[0];
}

async function main() {
  const commit = process.argv.includes("--commit");
  const revert = process.argv.includes("--revert");

  const tool = await getTool();
  const cfg = tool.tool_config;
  const props = cfg.api_schema?.request_body_schema?.properties || {};

  console.log("lookup_order parameter bindings:");
  for (const [prop, dv] of Object.entries(BINDINGS)) {
    if (!props[prop]) { console.log(`  ${prop.padEnd(15)} (not in schema — skipping)`); continue; }
    console.log(`  ${prop.padEnd(15)} dynamic_variable: ${JSON.stringify(props[prop].dynamic_variable)} -> ${JSON.stringify(revert ? "" : dv)}`);
  }
  if (!commit && !revert) { console.log("\n--- DRY RUN. --commit to apply, --revert to undo. ---"); return; }

  // The API rejects a property that carries both a description and a dynamic_variable:
  //   "Can only set one of: description, dynamic_variable, is_system_provided,
  //    constant_value, or is_omitted"
  // A bound parameter is filled by the runtime, so it has no prompt-facing description to
  // give the model. Keep the originals on disk so --revert can restore them exactly.
  const BACKUP = path.join(__dirname, "lookup-order-identity-backup.json");

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
    // Write the backup exactly ONCE. On a second --commit the live properties read back are
    // ALREADY bound (no description), so overwriting here would replace the true originals
    // with useless bound copies and permanently break --revert. The first backup is the
    // authoritative one; binding is idempotent, so re-running is otherwise harmless.
    if (fs.existsSync(BACKUP)) {
      console.log(`\nbackup already exists (${path.basename(BACKUP)}) — keeping the original, not overwriting.`);
    } else {
      fs.writeFileSync(BACKUP, JSON.stringify(saved, null, 2));
      console.log(`\noriginal properties saved -> ${path.basename(BACKUP)} (needed by --revert)`);
    }
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
  console.log(revert ? "\nUnbound: the model must supply identity again." : "\nBound: the runtime now fills identity from the conversation; the model cannot omit it.");
}

main().catch((e) => { console.error("\nError:", e.message); process.exit(1); });
