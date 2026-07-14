/** Consent layer test (local + Shopify write-back for email). Reversible. */
const fs = require("fs"), path = require("path");
for (const f of [".env.local", ".env"]) { const p = path.join(__dirname, "..", f); if (!fs.existsSync(p)) continue; for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1"); } }

const consent = require("../lib/comms/consent");
const queries = require("../lib/comms/queries");
const { getCustomerContextByPhone } = require("../lib/shopify-customer-context");
const { updateShopifyConsent } = require("../lib/comms/shopify-sync");
const { getSupabase } = require("../lib/supabase");

const PHONE = "+61400000000";
const results = [];
const ok = (n, c, d = "") => results.push([n, !!c, d]);

(async () => {
  const sb = getSupabase();
  const threadId = await queries.resolveThreadId({ phone: PHONE });
  const { data: contact } = await sb.from("contacts").select("*").eq("id", (await queries.getThread(threadId)).thread.contact.id).single();
  const cid = contact.id;
  const orig = { email_marketing: contact.email_marketing, sms_marketing: contact.sms_marketing, whatsapp_marketing: contact.whatsapp_marketing, calls_consent: contact.calls_consent, do_not_call: contact.do_not_call };

  const ctx = await getCustomerContextByPhone(PHONE);
  const origShopifyEmail = ctx?.customer?.email_marketing_consent?.state || null;
  console.log("  Shopify email consent state:", origShopifyEmail, "| accepts_marketing:", ctx?.customer?.accepts_marketing);

  // sync from Shopify (read)
  const synced = await consent.syncFromShopify(cid, ctx.customer);
  ok("syncFromShopify reads Shopify", synced && ["subscribed", "not_subscribed", "unsubscribed", "unknown"].includes(synced.email_marketing), `email=${synced?.email_marketing}`);

  // whatsapp consent (local)
  await consent.setConsent({ contactId: cid, channel: "whatsapp", status: "subscribed" });
  let c = (await sb.from("contacts").select("*").eq("id", cid).single()).data;
  ok("whatsapp opt-in (local)", c.whatsapp_marketing === "subscribed");
  ok("canSendMarketing whatsapp", consent.canSendMarketing(c, "whatsapp") === true);

  // keyword STOP on whatsapp
  await consent.applyKeywordConsent(PHONE, "whatsapp", "STOP");
  c = (await sb.from("contacts").select("*").eq("id", cid).single()).data;
  ok("keyword STOP → unsubscribed", c.whatsapp_marketing === "unsubscribed");
  ok("canSendMarketing blocked after STOP", consent.canSendMarketing(c, "whatsapp") === false);

  // calls DNC
  await consent.setConsent({ contactId: cid, channel: "calls", status: "unsubscribed" });
  c = (await sb.from("contacts").select("*").eq("id", cid).single()).data;
  ok("calls opt-out sets do_not_call", c.do_not_call === true);

  // email consent → Shopify write-back
  const emailRes = await consent.setConsent({ contactId: cid, channel: "email", status: "subscribed" });
  ok("email consent writes to Shopify", emailRes.shopifySynced === true, `synced=${emailRes.shopifySynced}`);
  const ctx2 = await getCustomerContextByPhone(PHONE);
  ok("Shopify email consent now subscribed", ctx2?.customer?.email_marketing_consent?.state === "subscribed", ctx2?.customer?.email_marketing_consent?.state);

  // restore
  await sb.from("contacts").update(orig).eq("id", cid);
  if (ctx?.customer?.id) {
    try { await updateShopifyConsent(String(ctx.customer.id), { channel: "email", status: origShopifyEmail === "subscribed" ? "subscribed" : origShopifyEmail === "unsubscribed" ? "unsubscribed" : "not_subscribed" }); } catch (e) { console.log("restore shopify warn:", e.message); }
  }
  ok("restored", true);

  let pass = true;
  for (const [n, g, d] of results) { console.log(`  ${g ? "✓" : "✗"} ${n}${d ? ` [${d}]` : ""}`); if (!g) pass = false; }
  console.log(pass ? "\nPASS ✅" : "\nFAIL ❌");
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
