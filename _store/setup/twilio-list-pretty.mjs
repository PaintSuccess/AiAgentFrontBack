// List default mobile + sydney AU candidates and score by repeating digits.
import { chromium } from "playwright";

function score(num) {
  const digits = num.replace(/\D/g, "");
  let best = 1, repeats = 0, pairs = 0;
  for (let i = 0; i < digits.length; i++) {
    let run = 1;
    while (i + run < digits.length && digits[i + run] === digits[i]) run++;
    if (run > best) best = run;
    if (run >= 2) { repeats += run; i += run - 1; }
  }
  // Also count adjacent pairs (e.g., 4488)
  for (let i = 0; i < digits.length - 1; i++) if (digits[i] === digits[i + 1]) pairs++;
  return best * 100 + pairs * 10 + repeats;
}

const browser = await chromium.connectOverCDP("http://localhost:9333");
const ctx = browser.contexts()[0];
let page = ctx.pages().find((p) => p.url().includes("twilio.com")) || (await ctx.newPage());
await page.bringToFront();

async function listKind(kind, label) {
  const types = kind === "mobile" ? "types[]=Mobile" : "types[]=Local";
  const caps = kind === "mobile" ? "capabilities[]=Sms&capabilities[]=Voice" : "capabilities[]=Voice";
  const url = `https://console.twilio.com/us1/develop/phone-numbers/manage/search?isoCountry=AU&${types}&${caps}&searchType=number&searchFilter=left&x-target-region=us1`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const btns = page.locator('button:has-text("Buy +61")');
  const n = await btns.count();
  console.log(`\n=== ${label} (${n} results) ===`);
  const list = [];
  for (let i = 0; i < n; i++) {
    const t = (await btns.nth(i).innerText()).replace(/\s+/g, " ").trim().replace(/^Buy /, "");
    list.push({ num: t, s: score(t) });
  }
  list.sort((a, b) => b.s - a.s);
  for (const c of list.slice(0, 15)) console.log(`  [${c.s}] ${c.num}`);
}

await listKind("mobile", "AU MOBILE candidates");
await listKind("local", "AU LOCAL candidates (mixed area codes)");

// Sydney-specific (area code 2). Try a few area-code-2 specific search filters.
console.log("\n--- Attempting Sydney 02 specific ---");
const url2 = `https://console.twilio.com/us1/develop/phone-numbers/manage/search?isoCountry=AU&types[]=Local&capabilities[]=Voice&searchType=number&searchFilter=left&searchTerm=02&x-target-region=us1`;
await page.goto(url2, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(3000);
const btns = page.locator('button:has-text("Buy +61 2")');
const n = await btns.count();
console.log(`Sydney (+61 2): ${n} results`);
const list = [];
for (let i = 0; i < n; i++) {
  const t = (await btns.nth(i).innerText()).replace(/\s+/g, " ").trim().replace(/^Buy /, "");
  list.push({ num: t, s: score(t) });
}
list.sort((a, b) => b.s - a.s);
for (const c of list.slice(0, 15)) console.log(`  [${c.s}] ${c.num}`);
