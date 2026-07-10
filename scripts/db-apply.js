/**
 * Applies SQL migrations in supabase/migrations/ (sorted) to the linked Supabase
 * project via the Management API. Uses SUPABASE_ACCESS_TOKEN (sbp_...) — no DB
 * password required.
 *
 *   node scripts/db-apply.js            # apply all migrations
 *   node scripts/db-apply.js 0001       # apply migrations whose name contains "0001"
 *
 * Env is read from .env.local then .env (local dev). In CI, real env vars win.
 */
const fs = require("fs");
const path = require("path");

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvFile(path.join(__dirname, "..", ".env.local"));
loadEnvFile(path.join(__dirname, "..", ".env"));

const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const ref = (SUPABASE_URL.match(/https?:\/\/([^.]+)\.supabase\.co/) || [])[1];

if (!ACCESS_TOKEN || !ref) {
  console.error("Missing SUPABASE_ACCESS_TOKEN or SUPABASE_URL (need project ref).");
  process.exit(1);
}

async function runSql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text}`);
  return text;
}

(async () => {
  const filter = process.argv[2] || "";
  const dir = path.join(__dirname, "..", "supabase", "migrations");
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql") && f.includes(filter))
    .sort();

  if (!files.length) {
    console.error(`No migrations matching "${filter}" in ${dir}`);
    process.exit(1);
  }

  console.log(`Project ref: ${ref}`);
  for (const file of files) {
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    process.stdout.write(`Applying ${file} ... `);
    await runSql(sql);
    console.log("ok");
  }
  console.log("Done.");
})().catch((err) => {
  console.error("\nMigration failed:", err.message);
  process.exit(1);
});
