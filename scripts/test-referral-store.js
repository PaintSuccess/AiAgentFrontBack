/**
 * End-to-end test for Click-to-WhatsApp ad attribution (migration 0005).
 * Creates a throwaway contact, asserts the three write targets, then deletes it.
 *   node scripts/test-referral-store.js
 *
 * Key case: first_referral must survive a SECOND ad touch. Meta's referral only ever
 * arrives on an ad-click message, so overwriting first touch would silently rewrite
 * history and misattribute the customer to whichever ad they clicked most recently.
 */
const fs = require("fs");
const path = require("path");

for (const f of [".env.local", ".env"]) {
  const p = path.join(__dirname, "..", f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1");
  }
}

const store = require("../lib/comms/store");
const { getSupabase } = require("../lib/supabase");

const PHONE = "+61400000199"; // throwaway
const results = [];
const ok = (n, c, d = "") => results.push([n, !!c, d]);

const FIRST_AD = { ctwa_clid: "CLID_FIRST", source_id: "AD_FIRST", source_type: "ad", headline: "First ad" };
const SECOND_AD = { ctwa_clid: "CLID_SECOND", source_id: "AD_SECOND", source_type: "ad", headline: "Second ad" };

(async () => {
  const sb = getSupabase();
  if (!sb) {
    console.error("No Supabase client — set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }

  await sb.from("contacts").delete().eq("phone", PHONE); // cascades; clean slate

  try {
    // 1) First ad click.
    const first = await store.recordInbound({
      channel: "whatsapp",
      fromPhone: PHONE,
      body: "Saw your ad",
      externalProvider: "twilio",
      externalId: "SM_ref_e2e_1",
      name: "Referral E2E",
      referral: FIRST_AD,
    });
    ok("inbound recorded", !!first?.contact?.id);

    const { data: c1 } = await sb.from("contacts").select("first_referral, first_referral_at").eq("id", first.contact.id).single();
    ok("contacts.first_referral pinned", c1?.first_referral?.ctwa_clid === "CLID_FIRST", JSON.stringify(c1?.first_referral));
    ok("contacts.first_referral_at set", !!c1?.first_referral_at);

    const { data: m1 } = await sb.from("messages").select("metadata").eq("id", first.message.id).single();
    ok("messages.metadata.referral stored", m1?.metadata?.referral?.ctwa_clid === "CLID_FIRST", JSON.stringify(m1?.metadata));

    const { data: e1 } = await sb.from("events").select("type, data").eq("contact_id", first.contact.id).eq("type", "ad_referral");
    ok("ad_referral event written", e1?.length === 1 && e1[0].data?.ctwa_clid === "CLID_FIRST", `count=${e1?.length}`);

    // 2) Second, DIFFERENT ad click — first touch must not move.
    const second = await store.recordInbound({
      channel: "whatsapp",
      fromPhone: PHONE,
      body: "Saw another ad",
      externalProvider: "twilio",
      externalId: "SM_ref_e2e_2",
      referral: SECOND_AD,
    });
    ok("second inbound recorded", !!second?.message?.id);

    const { data: c2 } = await sb.from("contacts").select("first_referral").eq("id", first.contact.id).single();
    ok("first_referral NOT overwritten by 2nd ad", c2?.first_referral?.ctwa_clid === "CLID_FIRST", JSON.stringify(c2?.first_referral));

    const { data: e2 } = await sb.from("events").select("type, data").eq("contact_id", first.contact.id).eq("type", "ad_referral");
    ok("both ad touches kept in events", e2?.length === 2, `count=${e2?.length}`);

    // 3) Ordinary message (no ad) must not disturb attribution.
    await store.recordInbound({
      channel: "whatsapp",
      fromPhone: PHONE,
      body: "Just a question",
      externalProvider: "twilio",
      externalId: "SM_ref_e2e_3",
    });
    const { data: e3 } = await sb.from("events").select("type").eq("contact_id", first.contact.id).eq("type", "ad_referral");
    ok("non-ad message adds no referral event", e3?.length === 2, `count=${e3?.length}`);

    // 4) Attribution lookup by click id — the CAPI path.
    const { data: found } = await sb.from("contacts").select("id").eq("first_referral->>ctwa_clid", "CLID_FIRST").limit(1);
    ok("contact findable by ctwa_clid (CAPI lookup)", found?.[0]?.id === first.contact.id);

    await sb.from("contacts").delete().eq("id", first.contact.id); // cascades
    const { data: gone } = await sb.from("contacts").select("id").eq("phone", PHONE);
    ok("cleanup", gone?.length === 0);
  } catch (err) {
    ok("no exception", false, err.message);
    await sb.from("contacts").delete().eq("phone", PHONE);
  }

  let pass = 0;
  for (const [n, c, d] of results) {
    console.log(`${c ? "PASS" : "FAIL"}  ${n}${d && !c ? `  — got: ${d}` : ""}`);
    if (c) pass++;
  }
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
})();
