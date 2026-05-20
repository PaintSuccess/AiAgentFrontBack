// Targeted purchase: pass the exact phone number string and country mode.
//   node twilio-buy-target.mjs "+61 480 846 611" mobile
//   node twilio-buy-target.mjs "+61 2 5838 5959" local
//
// Walks the modal wizard. For each step, screenshots, picks Business radio
// if shown, picks the first concrete option in any dropdown, then clicks
// Next/Buy this Number until done. Stops on any unexpected dialog.

import { chromium } from "playwright";
import fs from "node:fs";

const targetRaw = process.argv[2];
const mode = process.argv[3] || "mobile"; // "mobile" or "local"
if (!targetRaw) { console.error("Usage: node twilio-buy-target.mjs \"+61 ...\" [mobile|local]"); process.exit(2); }
const target = targetRaw.trim();
const targetDigits = target.replace(/\D/g, "");
console.log(`Target: ${target} (digits ${targetDigits}) mode=${mode}`);

const browser = await chromium.connectOverCDP("http://localhost:9333");
const ctx = browser.contexts()[0];
let page = ctx.pages().find((p) => p.url().includes("twilio.com")) || (await ctx.newPage());
await page.bringToFront();

fs.mkdirSync("test-output", { recursive: true });
const shot = (name) => page.screenshot({ path: `test-output/buy-${targetDigits}-${name}.png`, fullPage: true, timeout: 15000 }).catch((e) => console.log("shot err", e.message));

// 1. First reload search page so any stuck modal closes.
const types = mode === "mobile" ? "types[]=Mobile" : "types[]=Local";
const caps = mode === "mobile" ? "capabilities[]=Sms&capabilities[]=Voice" : "capabilities[]=Voice";
const areaCode = mode === "local" ? "&areaCode=2" : "";
const searchUrl = `https://console.twilio.com/us1/develop/phone-numbers/manage/search?isoCountry=AU&${types}&${caps}${areaCode}&searchType=number&pageSize=60&x-target-region=us1`;

console.log("→ Loading search page...");
await page.goto(searchUrl, { waitUntil: "domcontentloaded" });
await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(2500);

// 2. Find the target row. If not present in first page, paginate.
async function findTargetButton() {
  const all = await page.locator('button:has-text("Buy +61")').all();
  for (const b of all) {
    const txt = (await b.innerText()).replace(/\s+/g, "");
    if (txt.includes(targetDigits)) return b;
  }
  return null;
}
let btn = await findTargetButton();
let pageNum = 1;
while (!btn && pageNum < 5) {
  const next = page.locator('button[aria-label="Next page"], button:has-text("Next page")');
  if (!(await next.count()) || !(await next.first().isEnabled().catch(() => false))) break;
  await next.first().click();
  await page.waitForTimeout(2000);
  pageNum++;
  console.log(`  Searching page ${pageNum}...`);
  btn = await findTargetButton();
}
if (!btn) { console.error("ERROR: target not found in current listing."); await shot("notfound"); process.exit(3); }
console.log(`→ Clicking ${target}`);
await shot("before-buy");
await btn.click();
await page.waitForTimeout(2000);

// 3. Walk the wizard.
for (let step = 0; step < 10; step++) {
  await page.waitForTimeout(1500);
  await shot(`step${step}`);

  // Check if final success: modal closed or "Number purchased" toast.
  const successToast = page.locator('text=/purchased|added|congratulations/i');
  if (await successToast.count()) {
    console.log(`✓ Step ${step}: success indicator visible. Done.`);
    break;
  }

  // Business radio (if End-User step).
  const businessLabel = page.locator('label:has-text("Business")').first();
  if (await businessLabel.count()) {
    const checked = await page.locator('input[value="business"], input[name*="endUser"][type="radio"]:checked').count();
    if (!checked) {
      console.log(`  step ${step}: clicking Business radio`);
      await businessLabel.click().catch(() => {});
      await page.waitForTimeout(500);
    }
  }

  // Any visible select with a placeholder — pick first concrete option.
  const selects = await page.locator('select:visible').all();
  for (const sel of selects) {
    const cur = await sel.inputValue().catch(() => "");
    if (!cur) {
      const opts = await sel.locator('option').all();
      for (const o of opts) {
        const v = await o.getAttribute("value");
        if (v && v !== "") { await sel.selectOption(v).catch(() => {}); console.log(`  step ${step}: selected option ${v}`); break; }
      }
    }
  }

  // Also handle Paste UI combobox (button + listbox)
  const combobox = page.locator('[role="combobox"]:visible');
  const cbCount = await combobox.count();
  for (let i = 0; i < cbCount; i++) {
    const cb = combobox.nth(i);
    const txt = (await cb.innerText().catch(() => "")).trim();
    if (/select|choose|pick/i.test(txt)) {
      console.log(`  step ${step}: opening combobox "${txt}"`);
      await cb.click().catch(() => {});
      await page.waitForTimeout(500);
      const opt = page.locator('[role="option"]:visible').first();
      if (await opt.count()) {
        await opt.click().catch(() => {});
        await page.waitForTimeout(500);
      }
    }
  }

  // Decide which terminal button to press.
  const buyBtn = page.locator('button:has-text("Buy this Number"), button:has-text("Buy Number")');
  const nextBtn = page.locator('button:has-text("Next"):not([disabled])');
  const buyVisible = await buyBtn.count() && await buyBtn.first().isVisible().catch(() => false);
  const nextEnabled = await nextBtn.count() && await nextBtn.first().isEnabled().catch(() => false);

  console.log(`  step ${step}: buy=${buyVisible} next=${nextEnabled}`);

  if (buyVisible) {
    console.log("→ Clicking Buy this Number");
    await buyBtn.first().click();
    await page.waitForTimeout(4000);
    await shot(`step${step}-after-buy`);
    break;
  }
  if (nextEnabled) {
    await nextBtn.first().click();
    await page.waitForTimeout(1500);
  } else {
    console.log("  No actionable button. Stopping.");
    await shot(`step${step}-stuck`);
    break;
  }
}

console.log("Done. Check screenshots in test-output/");
