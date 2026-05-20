// Helpers for driving the independent Twilio Chrome on CDP :9333
// Reused by the buy-numbers/configure-numbers scripts.
import { chromium } from "playwright";

export async function getTwilioPage() {
  const browser = await chromium.connectOverCDP("http://localhost:9333");
  const ctx = browser.contexts()[0];
  let page = ctx.pages().find((p) => p.url().includes("twilio.com"));
  if (!page) page = await ctx.newPage();
  await page.bringToFront();
  return { browser, page };
}

export async function gotoTwilio(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  // Wait for the SPA to render content
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
}
