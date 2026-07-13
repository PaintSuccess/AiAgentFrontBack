/**
 * Backfill existing history into the comms spine so the Inbox is populated.
 *   node scripts/backfill-comms.js [elevenlabsMax] [twilioMax]
 *
 * - ElevenLabs conversations -> voice/chat threads (skips sms/whatsapp source;
 *   those are backfilled per-message from Twilio, matching live ingestion).
 * - Twilio messages -> sms/whatsapp inbound/outbound.
 * Idempotent: re-running is safe (dedupe by provider message id).
 */
const fs = require("fs");
const path = require("path");
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && process.env[m[1]] === undefined)
      process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  }
}
loadEnvFile(path.join(__dirname, "..", ".env.local"));
loadEnvFile(path.join(__dirname, "..", ".env"));

const store = require("../lib/comms/store");

const XI_KEY = process.env.ELEVENLABS_API_KEY;
const AGENT_ID = process.env.ELEVENLABS_AGENT_ID;
const SID = process.env.TWILIO_ACCOUNT_SID;
const TOKEN = process.env.TWILIO_AUTH_TOKEN;

const EL_MAX = parseInt(process.argv[2], 10) || 400;
const TW_MAX = parseInt(process.argv[3], 10) || 600;

function mapChannel(source) {
  const s = String(source || "").toLowerCase();
  if (s.includes("phone") || s.includes("twilio")) return "call";
  if (s.includes("sms")) return null; // captured from Twilio
  if (s.includes("whatsapp")) return null;
  return "chat";
}

async function elDetail(id) {
  const res = await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${id}`, {
    headers: { "xi-api-key": XI_KEY },
  });
  if (!res.ok) return null;
  return res.json();
}

async function backfillElevenLabs() {
  if (!XI_KEY || !AGENT_ID) return { skippedAll: "elevenlabs not configured" };
  let cursor = null, processed = 0, recorded = 0, skipped = 0;
  while (processed < EL_MAX) {
    const url = new URL("https://api.elevenlabs.io/v1/convai/conversations");
    url.searchParams.set("agent_id", AGENT_ID);
    url.searchParams.set("page_size", "100");
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await fetch(url, { headers: { "xi-api-key": XI_KEY } });
    if (!res.ok) {
      console.error("  EL list error", res.status, (await res.text()).slice(0, 200));
      break;
    }
    const data = await res.json();
    const convs = data.conversations || [];
    if (!convs.length) break;

    for (const c of convs) {
      processed++;
      const detail = await elDetail(c.conversation_id);
      if (!detail) { skipped++; continue; }
      const dyn = detail.conversation_initiation_client_data?.dynamic_variables || {};
      const md = detail.metadata || {};
      const an = detail.analysis || {};
      const phoneData = md.phone_call || md.twilio || md.call || {};
      // Detect voice calls by phone_call metadata (source lives in metadata, not
      // top level). SMS/WhatsApp are captured per-message from Twilio → skip here.
      const src = String(md.conversation_initiation_source || detail.conversation_initiation_source || "").toLowerCase();
      let channel;
      if (phoneData.external_number || phoneData.call_sid || phoneData.caller_id) channel = "call";
      else if (src.includes("whatsapp") || src.includes("sms")) channel = null;
      else channel = "chat";
      if (!channel) { skipped++; continue; }
      const r = await store.recordConversation({
        channel,
        conversationId: detail.conversation_id,
        phone: dyn.customer_phone || phoneData.external_number || phoneData.caller_id || phoneData.called_number,
        email: dyn.customer_email,
        name: (dyn.customer_name || "").replace(/^,\s*/, "").trim(),
        shopifyCustomerId: dyn.customer_id,
        direction: phoneData.direction || "inbound",
        transcript: (detail.transcript || []).map((t) => ({
          role: t.role, message: t.message, ts: t.time_in_call_secs,
        })),
        summary: an.transcript_summary,
        title: an.call_summary_title,
        status: detail.status,
        durationSeconds: md.call_duration_secs,
        result: an.call_successful,
        startedAt: md.start_time_unix_secs,
        cost: md.cost,
      });
      if (r) recorded++; else skipped++;
      if (processed % 25 === 0) console.log(`  EL: ${processed} processed, ${recorded} recorded…`);
      if (processed >= EL_MAX) break;
    }
    if (!data.has_more || !data.next_cursor) break;
    cursor = data.next_cursor;
  }
  return { processed, recorded, skipped };
}

async function backfillTwilio() {
  if (!SID || !TOKEN) return { skippedAll: "twilio not configured" };
  const auth = Buffer.from(`${SID}:${TOKEN}`).toString("base64");
  let pageUri = `/2010-04-01/Accounts/${SID}/Messages.json?PageSize=100`;
  let processed = 0, recorded = 0;
  while (pageUri && processed < TW_MAX) {
    const res = await fetch(`https://api.twilio.com${pageUri}`, {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!res.ok) { console.error("  Twilio error", res.status); break; }
    const data = await res.json();
    const msgs = data.messages || [];
    if (!msgs.length) break;

    for (const m of msgs) {
      processed++;
      const isWa = String(m.from || "").includes("whatsapp:") || String(m.to || "").includes("whatsapp:");
      const channel = isWa ? "whatsapp" : "sms";
      const inbound = String(m.direction || "").startsWith("inbound");
      const from = String(m.from || "").replace("whatsapp:", "");
      const to = String(m.to || "").replace("whatsapp:", "");
      const common = {
        channel, body: m.body || "", externalProvider: "twilio",
        externalId: m.sid, status: m.status, sentAt: m.date_sent || m.date_created,
      };
      const r = inbound
        ? await store.recordInbound({ ...common, fromPhone: from })
        : await store.recordOutbound({ ...common, toPhone: to, author: "ai" });
      if (r) recorded++;
      if (processed % 50 === 0) console.log(`  Twilio: ${processed} processed, ${recorded} recorded…`);
      if (processed >= TW_MAX) break;
    }
    pageUri = data.next_page_uri || null;
  }
  return { processed, recorded };
}

(async () => {
  console.log(`Backfilling (ElevenLabs max ${EL_MAX}, Twilio max ${TW_MAX})…`);
  console.log("ElevenLabs conversations…");
  console.log("  =>", JSON.stringify(await backfillElevenLabs()));
  console.log("Twilio messages…");
  console.log("  =>", JSON.stringify(await backfillTwilio()));
  console.log("Done.");
  process.exit(0);
})().catch((err) => {
  console.error("Backfill failed:", err.message);
  process.exit(1);
});
