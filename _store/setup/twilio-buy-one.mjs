// Buy one Twilio number end-to-end via the independent Chrome on CDP :9333.
// Usage:
//   node twilio-buy-one.mjs mobile
//   node twilio-buy-one.mjs sydney
import { chromium } from "playwright";
import { writeFile, mkdir } from "node:fs/promises";

const MODE = process.argv[2] || "mobile";
const OUT = "test-output";
await mkdir(OUT, { recursive: true });

const SEARCH_URLS = {
  mobile:
    "https://console.twilio.com/us1/develop/phone-numbers/manage/search?isoCountry=AU&types[]=Mobile&capabilities[]=Sms&capabilities[]=Voice&searchType=number&x-target-region=us1",
  sydney:
    "https://console.twilio.com/us1/develop/phone-numbers/manage/search?isoCountry=AU&types[]=Local&capabilities[]=Voice&searchTerm=2&searchFilter=left&searchType=number&x-target-region=us1",
};

const browser = await chromium.connectOverCDP("http://localhost:9333");
const ctx = browser.contexts()[0];
let page = ctx.pages().find((p) => p.url().includes("twilio.com")) || (await ctx.newPage());
await page.bringToFront();

console.log(`→ Going to ${MODE} search page...`);
await page.goto(SEARCH_URLS[MODE], { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(2000);

const buyBtns = page.locator('button:has-text("Buy +61")');
const n = await buyBtns.count();
console.log(`Found ${n} purchasable rows.`);
if (!n) {
  await page.screenshot({ path: `${OUT}/twilio-${MODE}-empty.png`, fullPage: true });
  console.error("✗ No rows. Screenshot saved.");
  process.exit(1);
}

const firstBtn = buyBtns.first();
const numLabel = (await firstBtn.innerText()).replace(/\s+/g, " ").trim();
console.log(`→ Selecting ${numLabel}`);
await firstBtn.click();
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/twilio-${MODE}-modal1.png`, fullPage: false });

// Step through wizard: keep clicking Next, then "Buy this Number".
for (let i = 0; i < 6; i++) {
  const next = page.locator('button:has-text("Next")').first();
  const buy = page
    .locator(
      'button:has-text("Buy this Number"), button:has-text("Buy this number"), button:has-text("Confirm Purchase")'
    )
    .first();
  const nextVisible = (await next.count()) ? await next.isVisible().catch(() => false) : false;
  const buyVisible = (await buy.count()) ? await buy.isVisible().catch(() => false) : false;
  console.log(`  step ${i}: next=${nextVisible} buy=${buyVisible}`);
  if (buyVisible) {
    await buy.click();
    console.log("→ Clicked Buy this Number.");
    break;
  }
  if (nextVisible) {
    await next.click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${OUT}/twilio-${MODE}-step${i + 1}.png`, fullPage: false });
    continue;
  }
  await page.screenshot({ path: `${OUT}/twilio-${MODE}-stuck.png`, fullPage: true });
  console.error("✗ No Next or Buy button visible. Screenshot saved.");
  process.exit(2);
}

await page.waitForTimeout(8000);
await page.screenshot({ path: `${OUT}/twilio-${MODE}-after.png`, fullPage: false });

// Verify
console.log("→ Verifying number appears in Active list...");
await page.goto(
  "https://console.twilio.com/us1/develop/phone-numbers/manage/incoming",
  { waitUntil: "domcontentloaded", timeout: 60000 }
);
await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(2000);
const rows = await page.evaluate(() =>
  [...document.querySelectorAll("table tr")]
    .map((r) => r.innerText.replace(/\s+/g, " ").trim())
    .filter((s) => s.includes("+61"))
);
console.log("=== ACTIVE AU NUMBERS ===");
for (const r of rows) console.log(r);
await writeFile(
  `${OUT}/twilio-${MODE}-active.txt`,
  rows.join("\n"),
  "utf8"
);
console.log(`\nWrote ${OUT}/twilio-${MODE}-active.txt`);
// Do NOT close the browser; user wants it kept open.
