/** Marketing read layer smoke test (read-only — touches nothing). node scripts/test-marketing.js */
const fs = require("fs"), path = require("path");
for (const f of [".env.local", ".env"]) { const p = path.join(__dirname, "..", f); if (!fs.existsSync(p)) continue; for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1"); } }
const marketing = require("../lib/comms/marketing");
(async () => {
  const o = await marketing.getMarketingOverview();
  console.log("AUDIENCE  contacts:", o.audience.totalContacts, "truncated:", o.audience.truncated, "do-not-call:", o.audience.doNotCall);
  for (const [k, v] of Object.entries(o.audience.channels)) {
    console.log(`  ${k.padEnd(9)} sub=${v.subscribed} unknown=${v.unknown} not_sub=${v.not_subscribed} unsub=${v.unsubscribed} no-address=${v.none}  [${v.engine}]`);
  }
  console.log("\nATTRIBUTION  ads:", o.attribution.ads.length, "touches:", o.attribution.totalTouches, "ad-sourced contacts:", o.attribution.adSourcedContacts);
  for (const a of o.attribution.ads.slice(0, 5)) console.log(`  ${a.sourceId || "?"} — ${a.headline || "(no headline)"} · ${a.contacts} contacts / ${a.touches} touches`);
  console.log("\nREACH (last", o.reach.windowDays, "days)");
  for (const c of o.reach.channels) console.log(`  ${c.key.padEnd(9)} in=${c.inbound} out=${c.outbound} delivered=${c.delivered} failed=${c.failed} pending=${c.pending} | delivered ${c.deliveredRate ?? "—"}% of ${c.settled} settled`);
  console.log("\nTEMPLATES  marketing:", o.templates.items.length, "utility:", o.templates.utilityCount, "available:", o.templates.available);
  for (const t of o.templates.items) console.log(`  ${t.name} (${t.category})`);
  console.log("\nOK");
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
