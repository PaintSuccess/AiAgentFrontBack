/**
 * End-to-end identity stitching: anonymous browsing → tagged link → attributed.
 * Creates a throwaway contact + events, then deletes them.
 *   node scripts/test-link-stitch.js
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
const lt = require("../lib/comms/link-token");
const { getSupabase } = require("../lib/supabase");
const handler = require("../api/pixel/collect");

const results = [];
const ok = (n, c, d = "") => results.push([n, !!c, d]);
const CLIENT = "__stitch_client__";
const CLIENT_FORGED = "__stitch_forged__";
const CLIENT_OTHER = "__stitch_other__";
const PHONE = "+61400000188";

function mkRes() {
  const r = { code: null };
  r.setHeader = () => {};
  r.status = (c) => { r.code = c; return r; };
  r.json = () => r;
  r.end = () => r;
  return r;
}
const post = (body) => Promise.resolve(handler({ method: "POST", body, headers: { origin: "null" } }, mkRes()));

(async () => {
  const sb = getSupabase();
  await sb.from("contacts").delete().eq("phone", PHONE);
  await sb.from("web_events").delete().in("client_id", [CLIENT, CLIENT_FORGED, CLIENT_OTHER]);

  const { data: contact } = await sb.from("contacts").insert({ phone: PHONE, name: "Stitch Test" }).select("id").single();
  ok("test contact created", !!contact?.id);

  // 1) Anonymous browsing, BEFORE they ever click one of our links.
  await post({
    clientId: CLIENT,
    events: [
      { name: "page_viewed", url: "https://www.paintaccess.com.au/" },
      { name: "product_viewed", url: "https://www.paintaccess.com.au/products/sprayer", product: { id: "p1", title: "Sprayer" } },
    ],
  });
  const { data: anon } = await sb.from("web_events").select("contact_id").eq("client_id", CLIENT);
  ok("anonymous events stored", anon.length === 2, `n=${anon.length}`);
  ok("...and they are genuinely anonymous", anon.every((r) => r.contact_id === null));

  // 2) We send a WhatsApp message; its storefront link gets tagged.
  const tagged = lt.tagLinks("Have a look: https://www.paintaccess.com.au/products/sprayer", contact.id);
  const taggedUrl = tagged.match(/https:\/\/\S+/)[0];
  ok("outbound link carries a token", /[?&]pa=/.test(taggedUrl), taggedUrl);

  // 3) They tap it. Same browser => same clientId.
  await post({ clientId: CLIENT, events: [{ name: "page_viewed", url: taggedUrl }] });

  const { data: after } = await sb.from("web_events").select("contact_id, name").eq("client_id", CLIENT);
  ok("all events now attributed", after.length === 3 && after.every((r) => r.contact_id === contact.id),
     JSON.stringify(after.map((r) => r.contact_id)));
  ok("...including browsing from BEFORE the click (back-filled)",
     after.filter((r) => r.contact_id === contact.id).length === 3);

  // 4) A forged token must attribute nobody.
  await post({ clientId: CLIENT_FORGED, events: [{ name: "page_viewed", url: "https://www.paintaccess.com.au/?pa=forged-rubbish" }] });
  const { data: forged } = await sb.from("web_events").select("contact_id").eq("client_id", CLIENT_FORGED);
  ok("forged token attributes nobody", forged.length === 1 && forged[0].contact_id === null, JSON.stringify(forged));

  // 5) A different browser must not inherit the identity.
  await post({ clientId: CLIENT_OTHER, events: [{ name: "page_viewed", url: "https://www.paintaccess.com.au/" }] });
  const { data: other } = await sb.from("web_events").select("contact_id").eq("client_id", CLIENT_OTHER);
  ok("a different browser stays anonymous", other[0].contact_id === null);

  await sb.from("web_events").delete().in("client_id", [CLIENT, CLIENT_FORGED, CLIENT_OTHER]);
  await sb.from("contacts").delete().eq("id", contact.id);
  const { data: gone } = await sb.from("contacts").select("id").eq("phone", PHONE);
  ok("cleanup", gone.length === 0);

  let pass = 0;
  for (const [n, c, d] of results) {
    console.log(`${c ? "PASS" : "FAIL"}  ${n}${d && !c ? ` — got: ${d}` : ""}`);
    if (c) pass++;
  }
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
})();
