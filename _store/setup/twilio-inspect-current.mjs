// Snapshot the existing Twilio number's configuration so we can replicate
// it onto the new replacement number.
import { getTwilioPage, gotoTwilio } from "./twilio-drive.mjs";

const { browser, page } = await getTwilioPage();

await gotoTwilio(
  page,
  "https://console.twilio.com/us1/develop/phone-numbers/manage/incoming"
);
await page.waitForTimeout(3000);

// Grab account SID + auth token from a quick API-side probe via cookies — not
// here. Instead just dump the active-numbers table so we can see what's there.
const numbers = await page.evaluate(() => {
  const rows = [...document.querySelectorAll("table tr")];
  return rows
    .map((r) =>
      [...r.querySelectorAll("td,th")]
        .map((c) => c.innerText.replace(/\s+/g, " ").trim())
        .join(" | ")
    )
    .filter((s) => s.length > 5);
});
console.log("=== ACTIVE NUMBERS TABLE ===");
for (const n of numbers) console.log(n);

await browser.close();
