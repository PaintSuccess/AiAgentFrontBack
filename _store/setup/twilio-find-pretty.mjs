// Search Twilio AU mobile numbers across several "beautiful" digit patterns
// to find memorable ones. Just lists candidates — does not buy.
import { chromium } from "playwright";
import fs from "node:fs";
const LOG = "find-pretty.log";
fs.writeFileSync(LOG, "");
const log = (...a) => { const s = a.join(" "); process.stdout.write(s + "\n"); fs.appendFileSync(LOG, s + "\n"); };

const PATTERNS = [
  "8888", "7777", "9999", "6666", "5555",
  "0000", "1111", "2222", "3333", "4444",
  "888", "999", "777", "666",
  "0420", "0488", "0411",
  "1234", "2345", "4321",
];

const browser = await chromium.connectOverCDP("http://localhost:9333");
const ctx = browser.contexts()[0];
let page = ctx.pages().find((p) => p.url().includes("twilio.com")) || (await ctx.newPage());
await page.bringToFront();

// First: dismiss any open modal by going to the dashboard then to search.
await page.goto("https://console.twilio.com/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);

const candidates = [];

async function search(kind, pattern, searchFilter) {
  const types = kind === "mobile" ? "types[]=Mobile" : "types[]=Local";
  const caps = kind === "mobile" ? "capabilities[]=Sms&capabilities[]=Voice" : "capabilities[]=Voice";
  const url = `https://console.twilio.com/us1/develop/phone-numbers/manage/search?isoCountry=AU&${types}&${caps}&searchTerm=${pattern}&searchFilter=${searchFilter}&searchType=number&x-target-region=us1`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const btns = page.locator('button:has-text("Buy +61")');
  const n = await btns.count();
  const found = [];
  for (let i = 0; i < Math.min(n, 8); i++) {
    const t = (await btns.nth(i).innerText()).replace(/\s+/g, " ").trim();
    found.push(t.replace(/^Buy /, ""));
  }
  return found;
}

for (const p of PATTERNS) {
  for (const filter of ["left", "any", "right"]) {
    try {
      const rows = await search("mobile", p, filter);
      if (rows.length) {
        log(`MOBILE  pat='${p}' filter=${filter}: ${rows.join(", ")}`);
        rows.forEach((r) => candidates.push({ kind: "mobile", pattern: p, filter, number: r }));
      }
    } catch (e) { log("err", p, filter, e.message); }
  }
}

log("\n=== sydney landline candidates (02 area) ===");
for (const p of ["8888", "7777", "9999", "6666", "1111", "2222", "3333", "5555", "4444"]) {
  for (const filter of ["any", "right"]) {
    try {
      const rows = await search("local", "02" + p, filter);
      if (rows.length) {
        log(`02-LOCAL pat='02${p}' filter=${filter}: ${rows.join(", ")}`);
        rows.forEach((r) => candidates.push({ kind: "local", pattern: "02" + p, filter, number: r }));
      }
    } catch (e) {}
  }
}

log(`\nTotal candidates: ${candidates.length}`);
// Score: prefer numbers with longest run of repeated digits
function score(num) {
  const digits = num.replace(/\D/g, "");
  let best = 0;
  for (let i = 0; i < digits.length; i++) {
    let run = 1;
    while (i + run < digits.length && digits[i + run] === digits[i]) run++;
    if (run > best) best = run;
  }
  return best;
}
const scored = candidates.map((c) => ({ ...c, score: score(c.number) }));
scored.sort((a, b) => b.score - a.score);

log("\n=== TOP 15 MOST MEMORABLE ===");
for (const c of scored.slice(0, 15)) {
  log(`  [${c.score}-run] ${c.kind.padEnd(7)} ${c.number}`);
}
