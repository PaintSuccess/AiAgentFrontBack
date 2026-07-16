/**
 * Marketing read layer — the audience/attribution view Omnisend structurally cannot give us.
 *
 * Scope is deliberate. Campaigns, email templates and automation flows live in Omnisend;
 * this never duplicates them. What only we hold is:
 *   - consent for WhatsApp + calls (Omnisend has neither channel)
 *   - which Meta ad a conversation came from (ctwa_clid — see migration 0005)
 *   - the cross-channel message event log
 *
 * Everything here is derived from data we actually store. Nothing is estimated.
 */
const { getSupabase } = require("../supabase");
const waTemplates = require("./wa-templates");

/** Consent states, in the order they're shown. `none` = we hold no address for that channel. */
const CONSENT_STATES = ["subscribed", "unknown", "not_subscribed", "unsubscribed", "none"];

const CHANNELS = [
  { key: "email", column: "email_marketing", addressColumn: "email", label: "Email", engine: "Omnisend" },
  { key: "sms", column: "sms_marketing", addressColumn: "phone", label: "SMS", engine: "Twilio" },
  { key: "whatsapp", column: "whatsapp_marketing", addressColumn: "phone", label: "WhatsApp", engine: "Twilio" },
  { key: "calls", column: "calls_consent", addressColumn: "phone", label: "Calls", engine: "Twilio" },
];

// Bounded so a large contacts table can't turn this page into a slow query. Contacts only
// holds people who have actually messaged us, so this ceiling is far above real volume;
// `truncated` tells the UI to stop claiming the numbers are complete if it is ever hit.
const CONTACT_SCAN_LIMIT = 20000;
const EVENT_SCAN_LIMIT = 50000;
const REACH_WINDOW_DAYS = 30;

function emptyBreakdown() {
  return CONSENT_STATES.reduce((acc, s) => ({ ...acc, [s]: 0 }), {});
}

/**
 * Reachable audience per channel.
 *
 * A contact with no address on that channel is counted as `none`, not `unknown` — the two
 * mean different things: `unknown` is someone we could ask, `none` is someone we cannot
 * reach at all. Collapsing them would overstate the addressable list.
 */
async function getAudience(sb) {
  const { data, error } = await sb
    .from("contacts")
    .select("email, phone, whatsapp, email_marketing, sms_marketing, whatsapp_marketing, calls_consent, do_not_call")
    .limit(CONTACT_SCAN_LIMIT);
  if (error) throw error;

  const rows = data || [];
  const channels = {};
  for (const ch of CHANNELS) {
    const breakdown = emptyBreakdown();
    for (const row of rows) {
      const address = ch.key === "whatsapp" ? row.whatsapp || row.phone : row[ch.addressColumn];
      if (!address) {
        breakdown.none += 1;
        continue;
      }
      // Do-not-call overrides any stored calls consent.
      if (ch.key === "calls" && row.do_not_call) {
        breakdown.unsubscribed += 1;
        continue;
      }
      const state = String(row[ch.column] || "unknown");
      breakdown[CONSENT_STATES.includes(state) ? state : "unknown"] += 1;
    }
    channels[ch.key] = { label: ch.label, engine: ch.engine, ...breakdown };
  }

  return {
    totalContacts: rows.length,
    truncated: rows.length >= CONTACT_SCAN_LIMIT,
    doNotCall: rows.filter((r) => r.do_not_call).length,
    channels,
  };
}

/**
 * Meta ad attribution, from the referral captured on the ad-click message.
 *
 * `contacts` are counted distinct: one person clicking the same ad twice is one lead, and
 * counting touches instead would silently inflate the ad's apparent performance.
 */
async function getAttribution(sb) {
  const { data, error } = await sb
    .from("events")
    .select("contact_id, data, occurred_at")
    .eq("type", "ad_referral")
    .order("occurred_at", { ascending: false })
    .limit(EVENT_SCAN_LIMIT);
  if (error) throw error;

  const events = data || [];
  const byAd = new Map();
  for (const ev of events) {
    const referral = ev.data || {};
    const id = referral.source_id || referral.ctwa_clid || "unknown";
    if (!byAd.has(id)) {
      byAd.set(id, {
        sourceId: referral.source_id || null,
        sourceType: referral.source_type || null,
        sourceUrl: referral.source_url || null,
        headline: referral.headline || null,
        body: referral.body || null,
        touches: 0,
        contacts: new Set(),
        lastSeen: ev.occurred_at,
      });
    }
    const ad = byAd.get(id);
    ad.touches += 1;
    if (ev.contact_id) ad.contacts.add(ev.contact_id);
    if (ev.occurred_at > ad.lastSeen) ad.lastSeen = ev.occurred_at;
  }

  const ads = [...byAd.values()]
    .map(({ contacts, ...ad }) => ({ ...ad, contacts: contacts.size }))
    .sort((a, b) => b.contacts - a.contacts || b.touches - a.touches);

  const { count: adSourcedContacts } = await sb
    .from("contacts")
    .select("id", { count: "exact", head: true })
    .not("first_referral", "is", null);

  return {
    ads,
    totalTouches: events.length,
    adSourcedContacts: adSourcedContacts || 0,
    lastTouchAt: events[0]?.occurred_at || null,
  };
}

// messages.status is the authoritative outcome. Backfilled history carries a final status
// but never produced status *events* (those only exist for live callbacks), so reading
// `events` here would report a ~5% delivery rate against a reality of ~79%.
const DELIVERED_STATES = new Set(["delivered", "read"]); // read implies delivered
const FAILED_STATES = new Set(["failed", "undelivered"]); // Twilio's undelivered == failed

/**
 * Channel reach and deliverability over the last 30 days, from `messages`.
 *
 * Rates are computed only over sends with a *definitive* outcome (delivered/read/failed).
 * Sends still awaiting a receipt are reported separately as `pending` rather than counted
 * as failures — otherwise an untracked send (e.g. a TwiML reply, which carries no message
 * id a status callback could ever match) would look like a delivery failure.
 */
async function getReach(sb) {
  const since = new Date(Date.now() - REACH_WINDOW_DAYS * 86400000).toISOString();
  const { data, error } = await sb
    .from("messages")
    .select("channel, direction, status")
    .gte("sent_at", since)
    .limit(EVENT_SCAN_LIMIT);
  if (error) throw error;

  const byChannel = {};
  for (const m of data || []) {
    const ch = m.channel || "unknown";
    byChannel[ch] = byChannel[ch] || { inbound: 0, outbound: 0, delivered: 0, failed: 0, pending: 0 };
    const c = byChannel[ch];
    if (m.direction === "inbound") {
      c.inbound += 1;
      continue;
    }
    c.outbound += 1;
    const status = String(m.status || "").toLowerCase();
    if (DELIVERED_STATES.has(status)) c.delivered += 1;
    else if (FAILED_STATES.has(status)) c.failed += 1;
    else c.pending += 1;
  }

  const channels = Object.entries(byChannel)
    .map(([key, c]) => {
      const settled = c.delivered + c.failed;
      return {
        key,
        ...c,
        settled,
        deliveredRate: settled ? Math.round((c.delivered / settled) * 100) : null,
        failedRate: settled ? Math.round((c.failed / settled) * 100) : null,
      };
    })
    .sort((a, b) => b.inbound + b.outbound - (a.inbound + a.outbound));

  return { windowDays: REACH_WINDOW_DAYS, channels };
}

/** Approved WhatsApp templates usable for marketing (Meta's MARKETING category). */
async function getMarketingTemplates() {
  try {
    const all = await waTemplates.listApprovedTemplates();
    return {
      items: all.filter((t) => String(t.category).toUpperCase() === "MARKETING"),
      utilityCount: all.filter((t) => String(t.category).toUpperCase() !== "MARKETING").length,
      available: true,
    };
  } catch (err) {
    // Twilio being unreachable must not take the whole page down.
    console.error("[marketing] template load failed:", err.message);
    return { items: [], utilityCount: 0, available: false, error: err.message };
  }
}

async function getMarketingOverview() {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase is not configured.");
  const [audience, attribution, reach, templates] = await Promise.all([
    getAudience(sb),
    getAttribution(sb),
    getReach(sb),
    getMarketingTemplates(),
  ]);
  return { audience, attribution, reach, templates, generatedAt: new Date().toISOString() };
}

module.exports = { getMarketingOverview, getAudience, getAttribution, getReach, getMarketingTemplates, CONSENT_STATES };
