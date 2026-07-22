/**
 * L3 funnel engine — end-to-end against the live DB, with delivery STUBBED (no real Twilio send).
 * Proves: enroll from a web_event → advance when due → consent gate → WhatsApp window (freeform vs
 * template) → frequency cap → send logged → completion. Creates a throwaway test contact, cleans up.
 *   node scripts/test-funnels.js
 */
const fs = require("fs");
const path = require("path");
for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (!fs.existsSync(p)) continue;
  for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1");
  }
}
// Engine reads these at call-time (cleanEnv), so setting here is enough.
process.env.ENABLE_FUNNELS = "1";
process.env.FUNNELS_TEST_ONLY = "true";
process.env.FUNNELS_QUIET_DISABLE = "true"; // deterministic regardless of AU clock
process.env.MARKETING_MAX_PER_WEEK = "3";

const { getSupabase } = require("../lib/supabase");
const providers = require("../lib/comms/funnels/providers");
const engine = require("../lib/comms/funnels/engine");

// Stub delivery — capture calls instead of hitting Twilio.
const sent = [];
providers.deliver = async (args) => { sent.push(args); return { id: "stub", status: "sent", provider: "internal" }; };

const results = [];
const ok = (n, c, d = "") => results.push([n, !!c, d]);
const PHONE = "+61400000155";

(async () => {
  const sb = getSupabase();
  await sb.from("contacts").delete().eq("phone", PHONE); // cascades enrollments/events/web_events

  // internal_test tag so FUNNELS_TEST_ONLY lets it through; whatsapp opted in.
  const { data: contact } = await sb.from("contacts")
    .insert({ phone: PHONE, whatsapp: PHONE, name: "Funnel Test", tags: ["internal_test"], whatsapp_marketing: "subscribed", sms_marketing: "subscribed" })
    .select("*").single();
  ok("test contact created", !!contact?.id);

  // A product_viewed web_event → should enroll into browse_abandon.
  await sb.from("web_events").insert({
    client_id: "cf", contact_id: contact.id, name: "product_viewed",
    url: "https://www.paintaccess.com.au/products/graco-495", product_id: "p1", product_title: "Graco 495 Sprayer",
    occurred_at: new Date(Date.now() - 60000).toISOString(),
  });

  const enroll = await engine._internal.enrollFromEvents(sb);
  const { data: enrolls } = await sb.from("funnel_enrollments").select("*").eq("contact_id", contact.id);
  ok("enrolled into browse_abandon", enrolls.some((e) => e.funnel_key === "browse_abandon"), JSON.stringify(enroll));
  ok("enroll_data captured the product", enrolls[0]?.enroll_data?.product === "Graco 495 Sprayer");

  // Re-running enroll must NOT create a duplicate (cooldown + unique-active index).
  await engine._internal.enrollFromEvents(sb);
  const { count: dupCount } = await sb.from("funnel_enrollments").select("id", { count: "exact", head: true }).eq("contact_id", contact.id).eq("funnel_key", "browse_abandon");
  ok("no duplicate enrollment", dupCount === 1, `count=${dupCount}`);

  // Make the step due, and give the contact a recent INBOUND message so the WA window is OPEN.
  const en = enrolls.find((e) => e.funnel_key === "browse_abandon");
  await sb.from("funnel_enrollments").update({ next_action_at: new Date(Date.now() - 1000).toISOString() }).eq("id", en.id);
  // window-open path needs a thread + inbound message; create minimal ones via the store.
  const store = require("../lib/comms/store");
  await store.recordInbound({ channel: "whatsapp", fromPhone: PHONE, body: "hi", externalProvider: "twilio", externalId: "SM_funnel_in_1" });

  sent.length = 0;
  const adv = await engine._internal.advanceDue(sb);
  ok("advance sent one message", adv.sent === 1, JSON.stringify(adv));
  ok("sent via WhatsApp, freeform (window open)", sent[0]?.channel === "whatsapp" && !!sent[0]?.body && !sent[0]?.template, JSON.stringify(sent[0]));
  ok("body interpolated the product", (sent[0]?.body || "").includes("Graco 495 Sprayer"));
  const { data: after } = await sb.from("funnel_enrollments").select("status").eq("id", en.id).single();
  ok("single-step funnel completed", after.status === "completed", after.status);
  const { count: evCount } = await sb.from("events").select("id", { count: "exact", head: true }).eq("contact_id", contact.id).eq("type", "funnel_sent");
  ok("funnel_sent event logged", evCount === 1, `count=${evCount}`);

  // ── Guard checks (fresh enrollment each time) ──
  async function freshDueEnrollment() {
    await sb.from("funnel_enrollments").delete().eq("contact_id", contact.id);
    const { data } = await sb.from("funnel_enrollments").insert({
      contact_id: contact.id, funnel_key: "browse_abandon", status: "active", current_step: 0,
      next_action_at: new Date(Date.now() - 1000).toISOString(), enroll_data: { product: "Test" },
    }).select("*").single();
    return data;
  }

  // Consent OFF → no send, exits as unsubscribed.
  await sb.from("contacts").update({ whatsapp_marketing: "unsubscribed", sms_marketing: "unsubscribed" }).eq("id", contact.id);
  await freshDueEnrollment(); sent.length = 0;
  const advNoConsent = await engine._internal.advanceDue(sb);
  ok("no send without consent", sent.length === 0 && advNoConsent.sent === 0);
  ok("unsubscribed → exits", advNoConsent.exited === 1, JSON.stringify(advNoConsent));

  // Frequency cap: re-consent, but pretend 3 already sent this week → deferred, no send.
  await sb.from("contacts").update({ whatsapp_marketing: "subscribed", sms_marketing: "subscribed" }).eq("id", contact.id);
  for (let i = 0; i < 3; i++) await sb.from("events").insert({ contact_id: contact.id, type: "funnel_sent", channel: "whatsapp" });
  await freshDueEnrollment(); sent.length = 0;
  const advCapped = await engine._internal.advanceDue(sb);
  ok("frequency cap defers, no send", sent.length === 0 && advCapped.deferred === 1, JSON.stringify(advCapped));

  // Kill switch: runSweep with ENABLE_FUNNELS unset does nothing.
  delete process.env.ENABLE_FUNNELS;
  const swept = await engine.runSweep();
  ok("kill switch disables the whole sweep", swept.skipped === "disabled", JSON.stringify(swept));

  await sb.from("contacts").delete().eq("id", contact.id);
  ok("cleanup", true);

  let pass = 0;
  for (const [n, c, d] of results) { console.log(`${c ? "PASS" : "FAIL"}  ${n}${d && !c ? ` — got: ${d}` : ""}`); if (c) pass++; }
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error("FAIL:", e.message, e.stack); process.exit(1); });
