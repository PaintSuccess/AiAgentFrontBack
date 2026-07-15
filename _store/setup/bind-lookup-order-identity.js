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

async function getTool() {
  const r = await fetch(`${BASE}/convai/tools`, { headers });
  if (!r.ok) throw new Error(`list tools failed: ${r.status}`);
  const j = await r.json();
  const tools = j.tools || j || [];
  const t = tools.find((x) => (x.tool_config?.name || x.name) === "lookup_order");
  if (!t) throw new Error("lookup_order tool not found");
  return t;
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

  const nextProps = { ...props };
  for (const [prop, dv] of Object.entries(BINDINGS)) {
    if (!nextProps[prop]) continue;
    nextProps[prop] = { ...nextProps[prop], dynamic_variable: revert ? "" : dv };
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
