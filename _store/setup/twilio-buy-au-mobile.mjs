// Search & buy a new AU mobile number on Twilio via the logged-in browser.
// Idempotent: re-running after success will detect existing AU mobiles and skip.
import { getTwilioPage, gotoTwilio } from "./twilio-drive.mjs";

const { browser, page } = await getTwilioPage();

console.log("→ Listing current numbers to avoid duplicates...");
await gotoTwilio(
  page,
  "https://console.twilio.com/us1/develop/phone-numbers/manage/incoming"
);
await page.waitForTimeout(3000);
const current = await page.evaluate(() =>
  [...document.querySelectorAll("table tr")].map((r) => r.innerText.replace(/\s+/g, " ").trim())
);
console.log("Current numbers:", current.length, "rows");

console.log("→ Opening AU mobile search...");
await gotoTwilio(
  page,
  "https://console.twilio.com/us1/develop/phone-numbers/manage/search?isoCountry=AU&types[]=Mobile&capabilities[]=Sms&capabilities[]=Voice&searchType=number&x-target-region=us1"
);
await page.waitForTimeout(4000);

// Try to detect a Buy button row
const buyButtons = page.locator('button:has-text("Buy +61")');
const count = await buyButtons.count();
console.log(`Found ${count} purchasable AU mobile rows.`);
if (!count) {
  console.error("✗ No AU mobile rows visible. Dumping page text:");
  const txt = await page.locator("body").innerText();
  console.log(txt.slice(0, 2000));
  await page.screenshot({ path: "test-output/twilio-au-mobile-empty.png", fullPage: true });
  process.exit(1);
}

// Pick the first row
const firstBtn = buyButtons.first();
const numText = await firstBtn.innerText();
console.log(`→ Buying: ${numText.replace(/\s+/g, " ").trim()}`);
await firstBtn.click();

// Wait for the confirmation/regulatory modal
await page.waitForTimeout(3000);
await page.screenshot({ path: "test-output/twilio-buy-mobile-modal.png", fullPage: true });

console.log("→ Modal opened. Pausing 60s for any regulatory selection if required.");
console.log("   (If you see a 'Buy this number' / regulatory bundle dialog, complete it. Script will continue automatically when a confirmation appears.)");

// Heuristic: try to click a "Buy this Number" / "Submit" button in the modal
const finalBuy = page
  .locator(
    'button:has-text("Buy this Number"), button:has-text("Buy this number"), button:has-text("Purchase"), button:has-text("Confirm Purchase")'
  )
  .first();
if (await finalBuy.count()) {
  await finalBuy.click();
  console.log("→ Clicked final 'Buy' button.");
}

await page.waitForTimeout(8000);
await page.screenshot({ path: "test-output/twilio-buy-mobile-result.png", fullPage: true });

console.log("→ Re-checking active numbers...");
await gotoTwilio(
  page,
  "https://console.twilio.com/us1/develop/phone-numbers/manage/incoming"
);
await page.waitForTimeout(3000);
const finalList = await page.evaluate(() =>
  [...document.querySelectorAll("table tr")].map((r) => r.innerText.replace(/\s+/g, " ").trim()).filter((s) => s.includes("+61"))
);
console.log("=== ACTIVE AU NUMBERS ===");
for (const n of finalList) console.log(n);

await browser.close();
