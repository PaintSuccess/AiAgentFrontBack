/**
 * Media pipeline end-to-end: upload a sample PDF → register → resolve public URL → confirm
 * the URL is publicly fetchable (Twilio must be able to GET it) → clean up.
 *   node scripts/test-media.js
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
const media = require("../lib/comms/media");
const { getSupabase } = require("../lib/supabase");

const results = [];
const ok = (n, c, d = "") => results.push([n, !!c, d]);
const KEY = "__test_sample_asset__";

// A tiny but VALID one-page PDF (so the content type is genuinely a PDF, not junk bytes).
const PDF = Buffer.from(
  "%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n" +
    "trailer<</Root 1 0 R>>\n%%EOF\n",
  "utf8"
);

(async () => {
  const sb = getSupabase();
  await sb.from("media_assets").delete().eq("asset_key", KEY);
  await sb.storage.from(media.bucketName()).remove([`${KEY}.pdf`]).catch(() => {});

  const asset = await media.uploadAsset({
    assetKey: KEY,
    title: "Sample funnel PDF",
    kind: "pdf",
    funnelStep: "recommend",
    buffer: PDF,
    mime: "application/pdf",
    filename: "sample.pdf",
  });
  ok("asset registered", !!asset?.id && asset.asset_key === KEY);
  ok("size + sha recorded", asset.size_bytes === PDF.length && !!asset.sha256);
  ok("public url stored", /^https?:\/\//.test(asset.public_url), asset.public_url);
  ok("storage coords stored (for R2 swap)", asset.storage_provider === "supabase" && !!asset.storage_key);

  // The critical property: Twilio has to be able to GET this URL. Fetch it as an outsider.
  const r = await fetch(asset.public_url);
  const bytes = Buffer.from(await r.arrayBuffer());
  ok("public url is fetchable (HTTP 200)", r.status === 200, `status=${r.status}`);
  ok("fetched bytes match what we uploaded", bytes.length === PDF.length, `${bytes.length} vs ${PDF.length}`);

  // Idempotent re-upload on the same key must not create a duplicate.
  await media.uploadAsset({ assetKey: KEY, title: "Sample funnel PDF v2", kind: "pdf", buffer: PDF, mime: "application/pdf", filename: "sample.pdf" });
  const { count } = await sb.from("media_assets").select("id", { count: "exact", head: true }).eq("asset_key", KEY);
  ok("re-upload is idempotent (no duplicate row)", count === 1, `count=${count}`);

  // The send-shaped media object maps kind → WhatsApp type correctly.
  const sendMedia = media.toSendMedia(asset, "Here's the guide");
  ok("send media maps pdf → document", sendMedia.type === "document" && sendMedia.url === asset.public_url);

  // Caption must be delivered on Twilio (which only reads top-level Body), not just nested in
  // media.caption (which only the Meta path reads). Intercept the send service to check.
  const sendMod = require("../lib/comms/send");
  const origSend = sendMod.sendMessage;
  let sent = null;
  sendMod.sendMessage = async (args) => { sent = args; return { id: "x" }; };
  await media.sendAssetOnWhatsApp({ to: "+61400000000", assetKey: KEY, caption: "Grab the guide" });
  sendMod.sendMessage = origSend;
  ok("caption passed as body (Twilio delivers it)", sent?.body === "Grab the guide", JSON.stringify(sent?.body));
  ok("caption also on media (Meta path)", sent?.media?.caption === "Grab the guide");

  const found = await media.getAsset(KEY);
  ok("getAsset resolves", found?.asset_key === KEY);
  const list = await media.listAssets({ kind: "pdf" });
  ok("listAssets includes it", list.some((a) => a.asset_key === KEY));

  await sb.from("media_assets").delete().eq("asset_key", KEY);
  await sb.storage.from(media.bucketName()).remove([`${KEY}.pdf`]);
  ok("cleanup", true);

  let pass = 0;
  for (const [n, c, d] of results) {
    console.log(`${c ? "PASS" : "FAIL"}  ${n}${d && !c ? ` — got: ${d}` : ""}`);
    if (c) pass++;
  }
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
