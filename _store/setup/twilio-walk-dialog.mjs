// Continue from current modal, scoping ALL clicks to [role="dialog"].
import { chromium } from "playwright";
import fs from "node:fs";

const browser = await chromium.connectOverCDP("http://localhost:9333");
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => p.url().includes("twilio.com"));
await page.bringToFront();
fs.mkdirSync("test-output", { recursive: true });
const shot = (n) => page.screenshot({ path: `test-output/walk-${n}.png`, fullPage: true, timeout: 15000 }).catch(() => {});

const dialog = () => page.locator('[role="dialog"]').last();

for (let step = 0; step < 15; step++) {
  await page.waitForTimeout(1500);
  await shot(String(step).padStart(2, "0"));
  const dlg = dialog();
  const dlgCount = await page.locator('[role="dialog"]').count();
  if (!dlgCount) {
    console.log(`step ${step}: no dialog — likely complete.`);
    if (await page.locator('text=/purchased|congratulations/i').count()) console.log("  ✓ success text found");
    break;
  }
  const heading = (await dlg.locator('h1, h2, h3').first().innerText().catch(() => "")).trim();
  console.log(`step ${step}: heading="${heading}"`);

  // Business radio if End-User step
  if (/end-user|who will/i.test(heading) || (await dlg.locator('text=/Business:/').count())) {
    if (!(await dlg.locator('input[type="radio"]:checked').count())) {
      console.log("  clicking Business radio");
      await dlg.locator('input[type="radio"]').first().click({ force: true }).catch((e) => console.log("  click err", e.message));
      await page.waitForTimeout(500);
    }
  }

  // Native selects in dialog
  for (const sel of await dlg.locator('select').all()) {
    if (!(await sel.isVisible().catch(() => false))) continue;
    const cur = await sel.inputValue().catch(() => "");
    if (!cur) {
      for (const o of await sel.locator('option').all()) {
        const v = await o.getAttribute("value");
        const t = (await o.innerText()).trim();
        if (v && t && !/select|choose/i.test(t)) {
          await sel.selectOption(v).catch(() => {});
          console.log(`  select->${t}`);
          break;
        }
      }
    }
  }

  // Paste-UI comboboxes inside dialog
  for (const cb of await dlg.locator('[role="combobox"]').all()) {
    if (!(await cb.isVisible().catch(() => false))) continue;
    const txt = (await cb.innerText().catch(() => "")).trim();
    console.log(`  combobox text="${txt.slice(0, 60)}"`);
    if (txt === "" || /select|choose|pick/i.test(txt)) {
      await cb.click().catch(() => {});
      await page.waitForTimeout(700);
      const opts = page.locator('[role="option"]');
      if (await opts.count()) {
        const optTxt = (await opts.first().innerText()).trim();
        console.log(`  combobox->"${optTxt.slice(0, 60)}"`);
        await opts.first().click().catch(() => {});
        await page.waitForTimeout(500);
      }
    }
  }

  // Buttons within dialog
  const buy = dlg.locator('button:has-text("Buy this Number"), button:has-text("Buy Number")');
  const next = dlg.locator('button:has-text("Next")');
  const buyVisible = (await buy.count()) && (await buy.first().isVisible().catch(() => false));
  const buyEnabled = buyVisible && (await buy.first().isEnabled().catch(() => false));
  const nextEnabled = (await next.count()) && (await next.first().isEnabled().catch(() => false));
  console.log(`  buy=${buyVisible}(en=${buyEnabled}) next=${nextEnabled}`);

  if (buyEnabled) {
    console.log("  → BUY THIS NUMBER");
    await buy.first().click();
    await page.waitForTimeout(6000);
    await shot(`${String(step).padStart(2, "0")}-after-buy`);
    continue; // loop checks for success/dialog-gone
  }
  if (nextEnabled) {
    await next.first().click();
    await page.waitForTimeout(1500);
  } else {
    console.log("  no actionable button. Stopping.");
    break;
  }
}
console.log("\nDone.");
