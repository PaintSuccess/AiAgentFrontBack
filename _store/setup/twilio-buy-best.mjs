// Buy best-scored AU phone in one session (avoid inventory rotation between scripts).
//   node twilio-buy-best.mjs mobile
//   node twilio-buy-best.mjs sydney   (filters to area code 2 from local results)

import { chromium } from "playwright";
import fs from "node:fs";

const mode = (process.argv[2] || "mobile").toLowerCase();
function score(num){const d=num.replace(/[^0-9]/g,"");let best=1,pairs=0,rep=0;for(let i=0;i<d.length;i++){let r=1;while(i+r<d.length&&d[i+r]===d[i])r++;if(r>best)best=r;if(r>=2){rep+=r;i+=r-1;}}for(let i=0;i<d.length-1;i++)if(d[i]===d[i+1])pairs++;return best*100+pairs*10+rep;}

const browser = await chromium.connectOverCDP("http://localhost:9333");
const ctx = browser.contexts()[0];
let page = ctx.pages().find((p) => p.url().includes("twilio.com")) || (await ctx.newPage());
await page.bringToFront();
fs.mkdirSync("test-output", { recursive: true });
const shot = (n) => page.screenshot({ path: `test-output/best-${mode}-${n}.png`, fullPage: true, timeout: 15000 }).catch((e) => console.log("shot err", e.message));

const types = mode === "mobile" ? "types[]=Mobile" : "types[]=Local";
const caps = mode === "mobile" ? "capabilities[]=Sms&capabilities[]=Voice" : "capabilities[]=Voice";
const url = `https://console.twilio.com/us1/develop/phone-numbers/manage/search?isoCountry=AU&${types}&${caps}&searchType=number&pageSize=60&x-target-region=us1`;

console.log("→ Loading search...");
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(3000);

const btns = await page.locator('button:has-text("Buy +61")').all();
console.log(`Found ${btns.length} rows.`);
const items = [];
for (const b of btns) {
  const t = (await b.innerText()).replace(/\s+/g, " ").trim().replace(/^Buy /, "");
  if (mode === "sydney" && !t.startsWith("+61 2 ")) continue;
  items.push({ num: t, s: score(t), btn: b });
}
items.sort((a, b) => b.s - a.s);
if (!items.length) { console.error("No matching rows."); process.exit(3); }
console.log("Top 5 candidates:");
items.slice(0, 5).forEach((c) => console.log(`  [${c.s}] ${c.num}`));

const pick = items[0];
console.log(`\n→ Picking: ${pick.num} (score ${pick.s})`);
await shot("before-click");
await pick.btn.click();
await page.waitForTimeout(2500);

const targetDigits = pick.num.replace(/\D/g, "");
fs.writeFileSync(`test-output/best-${mode}.picked.txt`, pick.num);

// Wizard walker
for (let step = 0; step < 12; step++) {
  await page.waitForTimeout(1500);
  await shot(`step${step}`);

  if (await page.locator('text=/Number purchased|congratulations|has been purchased/i').count()) {
    console.log(`✓ step ${step}: success.`);
    break;
  }

  // Click Business radio label
  const biz = page.locator('label:has-text("Business")').first();
  if (await biz.count()) {
    const already = await page.locator('input[type="radio"]:checked').count();
    if (!already) { console.log(`  step ${step}: clicking Business`); await biz.click().catch(() => {}); await page.waitForTimeout(700); }
  }

  // <select> dropdowns
  for (const sel of await page.locator('select:visible').all()) {
    const cur = await sel.inputValue().catch(() => "");
    if (!cur) {
      for (const o of await sel.locator('option').all()) {
        const v = await o.getAttribute("value");
        if (v) { await sel.selectOption(v).catch(() => {}); console.log(`  step ${step}: select->${v}`); break; }
      }
    }
  }

  // Paste UI combobox
  for (const cb of await page.locator('[role="combobox"]:visible').all()) {
    const txt = (await cb.innerText().catch(() => "")).trim();
    if (/select|choose|pick/i.test(txt) || txt === "") {
      await cb.click().catch(() => {});
      await page.waitForTimeout(500);
      const opt = page.locator('[role="option"]:visible').first();
      if (await opt.count()) { console.log(`  step ${step}: combobox->${(await opt.innerText()).trim().slice(0,40)}`); await opt.click().catch(() => {}); await page.waitForTimeout(500); }
    }
  }

  const buy = page.locator('button:has-text("Buy this Number"), button:has-text("Buy Number")');
  const next = page.locator('button:has-text("Next"):not([disabled])');
  const buyVisible = (await buy.count()) && (await buy.first().isVisible().catch(() => false));
  const nextEnabled = (await next.count()) && (await next.first().isEnabled().catch(() => false));
  console.log(`  step ${step}: buy=${buyVisible} next=${nextEnabled}`);

  if (buyVisible) {
    console.log("→ Buy this Number");
    await buy.first().click();
    await page.waitForTimeout(5000);
    await shot(`step${step}-after-buy`);
    break;
  }
  if (nextEnabled) {
    await next.first().click();
    await page.waitForTimeout(1500);
  } else {
    console.log("  No actionable button. Stopping.");
    await shot(`step${step}-stuck`);
    break;
  }
}
console.log(`\nPicked: ${pick.num}`);
console.log("See screenshots in test-output/");
