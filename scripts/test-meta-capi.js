/**
 * Meta CAPI lib test (pure — intercepts fetch, no real Meta calls).
 *   node scripts/test-meta-capi.js
 */
const results = [];
const ok = (n, c, d = "") => results.push([n, !!c, d]);

// Capture outgoing requests instead of hitting Meta.
let lastCall = null;
global.fetch = async (url, opts) => {
  lastCall = { url, body: JSON.parse(opts.body) };
  return { ok: true, json: async () => ({ events_received: 1 }) };
};

(async () => {
  // 1) Unconfigured → no-op, and NOTHING is sent.
  delete process.env.META_CAPI_ACCESS_TOKEN;
  let capi = freshRequire();
  lastCall = null;
  let r = await capi.sendConversion({ eventName: "LeadSubmitted", ctwaClid: "CLID1" });
  ok("unconfigured → skipped", r.skipped === "not_configured");
  ok("unconfigured → nothing sent", lastCall === null);
  ok("isConfigured false without token", capi.isConfigured() === false);

  // 2) Configured but no ctwa_clid → skipped (can't attribute).
  process.env.META_CAPI_ACCESS_TOKEN = "test-token";
  process.env.META_CAPI_DATASET_ID = "999";
  process.env.META_WABA_ID = "WABA1";
  capi = freshRequire();
  lastCall = null;
  r = await capi.sendConversion({ eventName: "Purchase", ctwaClid: null, value: 10, currency: "AUD" });
  ok("no ctwa_clid → skipped", r.skipped === "no_ctwa_clid");
  ok("no ctwa_clid → nothing sent", lastCall === null);

  // 3) Configured + ctwa_clid → correct payload.
  lastCall = null;
  r = await capi.sendConversion({ eventName: "Purchase", ctwaClid: "CLID9", value: 149.95, currency: "AUD" });
  ok("configured send → ok", r.ok === true);
  ok("endpoint uses dataset id", /\/999\/events\?access_token=/.test(lastCall.url), lastCall.url);
  const ev = lastCall.body.data[0];
  ok("event_name preserved", ev.event_name === "Purchase");
  ok("action_source = business_messaging", ev.action_source === "business_messaging");
  ok("messaging_channel = whatsapp", ev.messaging_channel === "whatsapp");
  ok("ctwa_clid in user_data", ev.user_data.ctwa_clid === "CLID9");
  ok("waba id in user_data", ev.user_data.whatsapp_business_account_id === "WABA1");
  ok("value + currency in custom_data", ev.custom_data.value === 149.95 && ev.custom_data.currency === "AUD");
  ok("event_time is unix seconds", Number.isInteger(ev.event_time) && ev.event_time > 1e9 && ev.event_time < 2e9);

  // 4) reportLead / reportPurchase pull clid from the contact's stored referral.
  lastCall = null;
  await capi.reportLead({ first_referral: { ctwa_clid: "CLID_LEAD" } });
  ok("reportLead uses contact.first_referral.ctwa_clid", lastCall.body.data[0].user_data.ctwa_clid === "CLID_LEAD");
  ok("reportLead sends LeadSubmitted", lastCall.body.data[0].event_name === "LeadSubmitted");
  lastCall = null;
  const r2 = await capi.reportPurchase({ first_referral: {} }, { value: 5 });
  ok("reportPurchase with no clid → skipped", r2.skipped === "no_ctwa_clid" && lastCall === null);

  let pass = 0;
  for (const [n, c, d] of results) { console.log(`${c ? "PASS" : "FAIL"}  ${n}${d && !c ? ` — got: ${d}` : ""}`); if (c) pass++; }
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
})();

function freshRequire() {
  delete require.cache[require.resolve("../lib/comms/meta-capi")];
  return require("../lib/comms/meta-capi");
}
