/**
 * Regression tests for the Orders page -> Comms Hub handoff.
 *
 * Every assertion here guards a defect that sends a message to the WRONG CUSTOMER or
 * silently corrupts a contact. They are cheap and offline: no network, no Supabase, no
 * Shopify. The React pieces are asserted against source text because the repo has no
 * JSX test transform — crude, but it pins the exact shapes that broke.
 *
 * Run: npm run test:comms-orders
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const APP = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(APP, p), "utf8");

let passed = 0;
const ok = (name) => { console.log(`ok  ${name}`); passed++; };

// ── 1. resolve-thread must never match a phone-directed action by email ──────────
// Order phone P2 + email E; contact X has email E but phone P1. An email fallback
// returns X's thread, and /api/comms/send takes the recipient from the thread's
// contact — so the message goes to P1 instead of the customer who ordered.
{
  const src = read("api/comms/resolve-thread.js");
  assert.ok(
    /const threadId = phone \? await resolveThreadId\(\{ phone \}\) : await resolveThreadId\(\{ email \}\);/.test(src),
    "resolve-thread must resolve by phone ONLY when a phone is supplied"
  );
  assert.ok(
    !/resolveThreadId\(\{ phone, email \}\)/.test(src),
    "resolve-thread must not pass phone+email together (re-enables the email fallback)"
  );
  ok("resolve-thread resolves phone-directed actions by phone only");
}

// ── 2. sendTemplate must prefer an explicit `to` over the selected thread ─────────
// Otherwise a template composed to a typed number is sent to whatever conversation
// happens to be open in the inbox.
{
  const src = read("src/pages/InboxPage.jsx");
  assert.ok(
    /const coldTo = tplModal\?\.to \|\| null;\s*\n\s*const threadId = coldTo \? null : detail\?\.thread\?\.id;/.test(src),
    "sendTemplate must null out threadId when an explicit `to` is present"
  );
  assert.ok(
    /setTplModal\(\(m\) => \(\{ \.\.\.m, stage: "pick"/.test(src),
    "template Back button must preserve `to`/`contact` via a functional update"
  );
  ok("sendTemplate targets the composed recipient, not the open thread");
}

// ── 3. A closed WhatsApp window must block free-form sends ───────────────────────
// The 24h window is opened by an INBOUND WhatsApp message; with none, a free-form
// send always fails (Twilio 63016).
{
  const src = read("src/pages/InboxPage.jsx");
  assert.ok(/if \(!lastIn\) return true;/.test(src), "waWindowClosed: no inbound WhatsApp => closed");
  assert.ok(
    /if \(channel === "whatsapp" && waWindowClosed\) return;/.test(src),
    "handleSend must guard the closed window (Enter bypasses the disabled button)"
  );
  ok("closed WhatsApp window blocks free-form sends (button + Enter)");
}

// ── 4. Contact identity must never select a contact — only the phone may ─────────
// RUNTIME test. `email`/`shopifyCustomerId` are match keys in store.resolveContact:
// if they reached it, an order to phone P2 whose email belongs to an existing contact
// on phone P1 would be LOGGED under P1 — and a later reply from that thread would be
// addressed to P1, i.e. the wrong customer. Network is stubbed; nothing is sent.
{
  process.env.DASHBOARD_DEV_BYPASS = "true";

  const intercepted = [];
  global.fetch = async (url) => {
    intercepted.push(String(url));
    if (String(url).includes("api.twilio.com")) {
      return { ok: true, status: 201, text: async () => JSON.stringify({ sid: "SM_test", status: "queued" }) };
    }
    throw new Error("blocked");
  };

  // Stub in place: lib/comms/send.js holds these by reference and looks up at call time.
  const wa = require("../lib/whatsapp");
  wa.sendWhatsAppMessage = async () => ({ id: "WA_test", status: "sent", provider: "twilio" });

  const store = require("../lib/comms/store");
  const seen = [];
  store.recordOutbound = async (input) => { seen.push(input); return { contact: { id: "c1" }, thread: { id: "t1" }, message: { id: "m1" } }; };
  const enriched = [];
  store.enrichContact = async (id, fields) => { enriched.push({ id, ...fields }); return {}; };

  const q = require("../lib/comms/queries");
  q.humanTakeoverThread = async () => ({});

  const handler = require("../api/comms/send.js");
  const mkRes = () => {
    const r = { statusCode: null, body: null };
    r.setHeader = () => {}; r.status = (c) => { r.statusCode = c; return r; };
    r.json = (b) => { r.body = b; return r; }; r.end = () => r;
    return r;
  };
  const call = async (body) => {
    const res = mkRes();
    await handler({ method: "POST", headers: {}, query: {}, body }, res);
    return res;
  };

  return (async () => {
    const bad = await call({ to: "+61400000001", channel: "email", body: "x" });
    assert.equal(bad.statusCode, 400, "email channel must be rejected (not sendable)");
    ok("send rejects unsupported channels");

    const noRecipient = await call({ channel: "sms", body: "x" });
    assert.equal(noRecipient.statusCode, 400, "a send with no recipient must 400");
    ok("send requires a recipient");

    // THE REGRESSION: an order-initiated send carrying full identity.
    seen.length = 0; enriched.length = 0;
    const r = await call({
      to: "+61400000001",
      channel: "whatsapp", // stubbed sender; the SMS path would need real Twilio env
      body: "hi",
      contact: { name: "Hayden Hopley", email: "shared@trade.com.au", shopifyCustomerId: "8958804033639" },
    });
    assert.equal(r.statusCode, 200, "the send should succeed");
    assert.equal(seen.length, 1, "recordOutbound must have been reached");
    assert.equal(seen[0].name, "Hayden Hopley", "name IS forwarded (safe: never a match key)");
    assert.equal(seen[0].email, undefined, "email must NOT reach resolveContact (it is a match key)");
    assert.equal(seen[0].shopifyCustomerId, undefined, "shopifyCustomerId must NOT reach resolveContact");
    assert.equal(seen[0].toPhone, "+61400000001", "the phone is the only contact selector");
    ok("phone-directed send: only the phone (+ safe name) can select the contact");

    // ...but the identity is still attached afterwards, so contacts aren't anonymous.
    assert.equal(enriched.length, 1, "enrichContact must run after logging");
    assert.deepEqual(enriched[0], { id: "c1", email: "shared@trade.com.au", shopifyCustomerId: "8958804033639" });
    ok("identity is attached post-hoc via enrichContact (empty columns only)");

    // A GID must never be stored: updateShopifyCustomer() does Number(id) -> NaN.
    seen.length = 0; enriched.length = 0;
    await call({ to: "+61400000001", channel: "whatsapp", body: "hi", contact: { shopifyCustomerId: "gid://shopify/Customer/895880" } });
    assert.equal(enriched.length, 0, "a non-numeric shopify customer id must be dropped, not stored");
    ok("GraphQL GID customer id is dropped, never stored");

    // A threadId send must never take client-supplied identity.
    const src = read("api/comms/send.js");
    assert.ok(/contact: body\.threadId \? null : contact/.test(src), "threadId sends must ignore client identity");
    ok("threadId sends ignore client-supplied identity");

    assert.ok(!intercepted.some((u) => !u.includes("api.twilio.com")), "no unexpected hosts contacted");

    // ── 4b. enrichContact must fill atomically, never read-then-overwrite ──────────
    // A read-then-write races: two concurrent sends both see an empty column and the
    // later write clobbers the earlier. Each fill must be `WHERE id = ? AND col IS NULL`.
    {
      const realStore = require("../lib/comms/store.js");
      // Restore the real implementation (section 4 stubbed it) and fake Supabase.
      delete require.cache[require.resolve("../lib/comms/store.js")];
      const supa = require("../lib/supabase");
      const calls = [];
      const chain = (record) => ({
        update(patch) { record.patch = patch; return this; },
        eq(col, val) { (record.eq ||= []).push([col, val]); return this; },
        is(col, val) { (record.is ||= []).push([col, val]); return this; },
        select(...a) { record.select = a.length ? a : true; return this; }, // recorded: a read here is the race
        maybeSingle: async () => { record.read = true; return { data: null }; },
        then: undefined,
      });
      supa.getSupabase = () => ({
        from() { const rec = {}; calls.push(rec); const c = chain(rec); c.then = (res) => res({ error: null }); return c; },
      });
      const fresh = require("../lib/comms/store.js");
      await fresh.enrichContact("c1", { email: "a@b.com", shopifyCustomerId: "123" });

      // Exactly two writes, no reads: a read of the current value before writing is
      // precisely the read-then-write race this guards against.
      assert.equal(calls.length, 2, "enrichContact must issue exactly two updates (one per column)");
      assert.ok(calls.every((c) => !c.select && !c.read), "enrichContact must not read before writing (race)");
      assert.ok(calls.every((c) => c.patch), "every call must be an update");

      const emailCall = calls.find((c) => "email" in c.patch);
      assert.ok(emailCall, "email must be filled via an update");
      assert.deepEqual(emailCall.patch, { email: "a@b.com" });
      assert.deepEqual(emailCall.eq, [["id", "c1"]], "the fill must target this contact");
      assert.deepEqual(emailCall.is, [["email", null]], "email fill must be guarded by IS NULL (atomic, fill-only)");

      const idCall = calls.find((c) => "shopify_customer_id" in c.patch);
      assert.ok(idCall, "shopify_customer_id must be filled via an update");
      assert.deepEqual(idCall.eq, [["id", "c1"]], "the fill must target this contact");
      assert.deepEqual(idCall.is, [["shopify_customer_id", null]], "customer id fill must be guarded by IS NULL");

      assert.ok(
        /error\.code !== UNIQUE_VIOLATION/.test(read("lib/comms/store.js")),
        "a unique value owned by another contact must be skipped, not stolen"
      );
      ok("enrichContact fills atomically (IS NULL guard) and never steals a unique value");
      void realStore;
    }

    // ── 5. Order phones must be normalised AU-aware ───────────────────────────────
    // shippingAddress.phone is free text ("0407302088"); normalizeE164 would make
    // "+0407302088" and silently fail to match the real contact.
    const { normalizePhone } = require("../lib/shopify-customer-context");
    assert.equal(normalizePhone("0407302088"), "+61407302088");
    assert.equal(normalizePhone("0481 358 368"), "+61481358368");
    assert.equal(normalizePhone("+61447301034"), "+61447301034");
    assert.equal(normalizePhone("+16154737857"), "+16154737857", "international numbers must survive");
    const opsSrc = read("lib/shopify-ops.js");
    assert.ok(
      /customer_phone: normalizePhone\(order\.customer\?\.phone \|\| order\.shippingAddress\?\.phone\)/.test(opsSrc),
      "mapOrderSummary must normalise the order phone (incl. the shippingAddress fallback)"
    );
    ok("order phones are normalised to E.164 (AU-aware)");

    console.log(`\n${passed} passed`);
  })();
}
