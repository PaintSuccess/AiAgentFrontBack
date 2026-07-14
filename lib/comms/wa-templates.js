/**
 * WhatsApp template registry — reads the account's Meta-APPROVED templates live
 * from the Twilio Content API (so newly-approved templates appear automatically,
 * no code change). Cached briefly to avoid hammering Twilio on every load.
 */
const { cleanEnv } = require("../shopify");

const CACHE_MS = 5 * 60 * 1000;
let cache = { at: 0, items: [] };

function twAuth() {
  return Buffer.from(`${cleanEnv("TWILIO_ACCOUNT_SID")}:${cleanEnv("TWILIO_AUTH_TOKEN")}`).toString("base64");
}
async function twFetch(url) {
  const r = await fetch(url, { headers: { Authorization: `Basic ${twAuth()}` } });
  if (!r.ok) throw new Error(`Twilio Content ${r.status}`);
  return r.json();
}
function bodyOf(c) {
  const t = c.types || {};
  return t["twilio/text"]?.body || t["twilio/quick-reply"]?.body || t["twilio/call-to-action"]?.body || "";
}

/** Fill {{1}}, {{2}}… with positional variables ({ "1": "...", "2": "..." }). */
function renderBody(body, variables = {}) {
  return String(body || "").replace(/\{\{(\d+)\}\}/g, (_, n) => (variables[n] != null ? String(variables[n]) : `{{${n}}}`));
}

/** All WhatsApp-approved templates: { sid, name, language, category, body, variables[] }. */
async function listApprovedTemplates({ force = false } = {}) {
  if (!cleanEnv("TWILIO_ACCOUNT_SID")) return [];
  if (!force && Date.now() - cache.at < CACHE_MS) return cache.items;

  const data = await twFetch("https://content.twilio.com/v1/Content?PageSize=100");
  const items = [];
  for (const c of data.contents || []) {
    let wa = null;
    try {
      const ar = await twFetch(`https://content.twilio.com/v1/Content/${c.sid}/ApprovalRequests`);
      wa = ar.whatsapp;
    } catch {
      /* skip templates whose approval status can't be read */
    }
    if (!wa || wa.status !== "approved") continue;
    items.push({
      sid: c.sid,
      name: c.friendly_name,
      language: c.language || "en",
      category: wa.category || "UTILITY",
      body: bodyOf(c),
      variables: Object.entries(c.variables || {}).map(([index, example]) => ({ index, example })),
    });
  }
  cache = { at: Date.now(), items };
  return items;
}

async function getTemplate(sidOrName) {
  const items = await listApprovedTemplates();
  return items.find((t) => t.sid === sidOrName || t.name === sidOrName) || null;
}

module.exports = { listApprovedTemplates, getTemplate, renderBody };
