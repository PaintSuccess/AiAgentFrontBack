// Check webhook config on all 3 numbers
import { chromium } from "playwright";
import fs from "node:fs";

const browser = await chromium.connectOverCDP("http://localhost:9333");
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => p.url().includes("twilio.com")) || (await ctx.newPage());
await page.bringToFront();
fs.mkdirSync("test-output", { recursive: true });

const numbers = [
  { label: "mobile",  num: "61485077888" },
  { label: "sydney",  num: "61258385959" },
  { label: "old",     num: "61488826453" },
];

for (const n of numbers) {
  const url = `https://console.twilio.com/us1/develop/phone-numbers/manage/incoming/${n.num}/edit`;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `test-output/config-${n.label}.png`, fullPage: true, timeout: 15000 }).catch(() => {});
  console.log(`Screenshot: config-${n.label}.png  (${url})`);
}
