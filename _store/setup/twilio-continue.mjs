// Continue purchase wizard from currently-open modal.
// Clicks the Business radio properly, then walks Next/Buy.
import { chromium } from "playwright";
import fs from "node:fs";

const browser = await chromium.connectOverCDP("http://localhost:9333");
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => p.url().includes("twilio.com"));
if (!page) { console.error("No Twilio page"); process.exit(1); }
await page.bringToFront();
fs.mkdirSync("test-output", { recursive: true });
const shot = (n) => page.screenshot({ path: `test-output/continue-${n}.png`, fullPage: true, timeout: 15000 }).catch(() => {});

async function clickBusinessRadio() {
  // Try multiple strategies
  const strategies = [
    () => page.locator('input[type="radio"][value="business"]').first().click({ force: true }),
    () => page.locator('input[type="radio"]').first().click({ force: true }),
    () => page.getByText(/^Business:/).click(),
    () => page.locator('label').filter({ hasText: /Business:/ }).locator('input[type="radio"]').click({ force: true }),
  ];
  for (const s of strategies) {
    try { await s(); await page.waitForTimeout(500);
      const checked = await page.locator('input[type="radio"]:checked').count();
      if (checked) { console.log("  ✓ Business radio is checked"); return true; }
    } catch (e) { console.log("  strategy failed:", e.message.slice(0, 80)); }
  }
  return false;
}

console.log("Initial screenshot...");
await shot("00-start");

// Check what step we're on by looking for visible headings/buttons
const hasBusiness = await page.locator('text=/Business:/').count();
if (hasBusiness) {
  console.log("→ End-User step detected. Selecting Business...");
  await clickBusinessRadio();
}

for (let step = 0; step < 12; step++) {
  await page.waitForTimeout(1500);
  await shot(`${String(step + 1).padStart(2, "0")}`);

  if (await page.locator('text=/Number purchased|congratulations|has been purchased|number purchased successfully/i').count()) {
    console.log(`✓ Step ${step}: success.`);
    break;
  }

  // If Business radio exists and not checked, click it
  if (await page.locator('text=/Business:/').count() && !(await page.locator('input[type="radio"]:checked').count())) {
    await clickBusinessRadio();
  }

  // Handle native selects
  for (const sel of await page.locator('select').all()) {
    if (!(await sel.isVisible().catch(() => false))) continue;
    const cur = await sel.inputValue().catch(() => "");
    if (!cur) {
      for (const o of await sel.locator('option').all()) {
        const v = await o.getAttribute("value");
        const t = (await o.innerText()).trim();
        if (v && t && !/select|choose/i.test(t)) {
          await sel.selectOption(v).catch(() => {});
          console.log(`  step ${step}: select->${t}`);
          break;
        }
      }
    }
  }

  // Paste-UI comboboxes (look for [role=combobox] inside the modal)
  for (const cb of await page.locator('[role="combobox"]').all()) {
    if (!(await cb.isVisible().catch(() => false))) continue;
    const txt = (await cb.innerText().catch(() => "")).trim();
    if (txt === "" || /select|choose|pick a/i.test(txt)) {
      await cb.click().catch(() => {});
      await page.waitForTimeout(500);
      const opts = page.locator('[role="option"]');
      if (await opts.count()) {
        const first = opts.first();
        const optTxt = (await first.innerText()).trim();
        console.log(`  step ${step}: combobox->"${optTxt.slice(0, 50)}"`);
        await first.click().catch(() => {});
        await page.waitForTimeout(500);
      }
    }
  }

  const buy = page.locator('button:has-text("Buy this Number"), button:has-text("Buy Number")');
  const next = page.locator('button:has-text("Next")');
  const buyVisible = (await buy.count()) && (await buy.first().isVisible().catch(() => false));
  const nextVisible = (await next.count()) && (await next.first().isVisible().catch(() => false));
  const nextEnabled = nextVisible && (await next.first().isEnabled().catch(() => false));
  console.log(`  step ${step}: buy=${buyVisible} next=${nextVisible}(enabled=${nextEnabled})`);

  if (buyVisible && (await buy.first().isEnabled().catch(() => false))) {
    console.log("→ Buy this Number");
    await buy.first().click();
    await page.waitForTimeout(5000);
    await shot(`${String(step + 1).padStart(2, "0")}-after-buy`);
    break;
  }
  if (nextEnabled) {
    await next.first().click();
    await page.waitForTimeout(1500);
  } else {
    console.log("  No actionable button. Stopping.");
    break;
  }
}
console.log("\nDone. Screenshots in test-output/continue-*.png");
