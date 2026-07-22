/**
 * L3 funnel engine — enroll known contacts into behavioral chains and advance them on schedule.
 *
 * ONE sweep does both: (1) enroll contacts whose recent web_events match a funnel's entry rule,
 * (2) advance enrollments whose step is due. Driven by an external scheduler (Supabase pg_cron)
 * hitting /api/cron/funnels; the logic here is scheduler-agnostic.
 *
 * SAFETY IS THE FEATURE — this is the first thing that sends marketing unprompted:
 *   - ENABLE_FUNNELS unset            → whole engine inert (ships dark)
 *   - FUNNELS_TEST_ONLY=true          → only internal_test / staff contacts
 *   - canSendMarketing() every send   → consent gate (the H5 enforcement)
 *   - MARKETING_MAX_PER_WEEK          → per-contact frequency cap across all funnels
 *   - AU quiet hours 21:00–09:00      → defer, never send overnight
 *   - WhatsApp 24h window             → freeform inside, approved template outside
 *   - unique active enrollment + a `processing` lease → no double-send across overlapping sweeps
 */
const { cleanEnv } = require("../../shopify");
const { getSupabase } = require("../../supabase");
const consent = require("../consent");
const providers = require("./providers");
const { isInternalContact } = require("../marketing");
const FUNNELS = require("./definitions");

const ENROLL_LOOKBACK_MIN = 20; // web_events window per sweep (covers a ~15-min cron + margin)
const MAX_FUNNEL_AGE_DAYS = 3; // give up on an enrollment that can't proceed for this long
const DEFER_MINUTES = 120; // reschedule when a step can't send right now
// AU-local hours during which sends pause. Env-tunable; FUNNELS_QUIET_DISABLE=true turns it off.
const QUIET_START = Number(cleanEnv("FUNNELS_QUIET_START") || 21);
const QUIET_END = Number(cleanEnv("FUNNELS_QUIET_END") || 9);
const quietDisabled = () => String(cleanEnv("FUNNELS_QUIET_DISABLE") || "").toLowerCase() === "true";

const enabled = () => !!cleanEnv("ENABLE_FUNNELS");
const testOnly = () => String(cleanEnv("FUNNELS_TEST_ONLY") || "").toLowerCase() === "true";
const freqCap = () => Number(cleanEnv("MARKETING_MAX_PER_WEEK") || 3);

// ── small helpers ────────────────────────────────────────────────────────────
function parseDelayMs(s) {
  const m = String(s || "").match(/^(\d+)\s*([mhd])$/);
  if (!m) return 0;
  const n = Number(m[1]);
  return n * ({ m: 60000, h: 3600000, d: 86400000 }[m[2]]);
}
const iso = (d) => new Date(d).toISOString();
function interpolate(text, vars) {
  return String(text || "").replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ""));
}
function funnelByKey(key) {
  return FUNNELS.find((f) => f.key === key) || null;
}

/** AU-local hour right now (handles DST via the IANA zone). */
function auHour(now = new Date()) {
  const h = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", hour: "numeric", hour12: false }).format(now);
  return Number(h) % 24;
}
function inQuietHours(now = new Date()) {
  if (quietDisabled()) return false;
  const h = auHour(now);
  return h >= QUIET_START || h < QUIET_END;
}

/** Is the WhatsApp 24h service window open? (last INBOUND message < 24h ago) */
async function whatsappWindowOpen(sb, contactId) {
  const { data } = await sb
    .from("messages")
    .select("sent_at")
    .eq("contact_id", contactId)
    .eq("direction", "inbound")
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.sent_at) return false;
  return Date.now() - new Date(data.sent_at).getTime() < 24 * 3600000;
}

async function sentThisWeek(sb, contactId) {
  const since = iso(Date.now() - 7 * 86400000);
  const { count } = await sb
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("contact_id", contactId)
    .eq("type", "funnel_sent")
    .gte("occurred_at", since);
  return count || 0;
}

// ── channel resolution + send ────────────────────────────────────────────────
/**
 * Pick the first channel that is sequenceable + consented + addressable + sendable, and send.
 * @returns {"sent"|"deferred"|"exit_unsubscribed"|"no_channel"}
 */
async function runStep(sb, enrollment, funnel, step, contact) {
  const vars = {
    name: (contact.name || "").split(" ")[0] || "there",
    product: enrollment.enroll_data?.product || "that",
  };

  let anyChannelConsentedButUnsendable = false;
  let anyExplicitUnsub = false;

  for (const channel of step.channels) {
    if (!providers.isSequenced(channel)) continue; // e.g. email = native_parallel → runs elsewhere

    const consented = consent.canSendMarketing(contact, channel);
    const status = channel === "sms" ? contact.sms_marketing : contact.whatsapp_marketing;
    if (status === "unsubscribed") anyExplicitUnsub = true;
    if (!consented) continue;

    const to = contact.whatsapp || contact.phone;
    if (!to) continue;

    // Build the send for this channel.
    let sendArgs = null;
    if (channel === "whatsapp") {
      const windowOpen = await whatsappWindowOpen(sb, contact.id);
      if (windowOpen && step.content.text) {
        sendArgs = { channel, to, body: interpolate(step.content.text, vars), contact };
      } else if (step.content.template) {
        // Outside the window (or no freeform text) → approved template.
        sendArgs = { channel, to, template: { name: step.content.template, variables: { 1: vars.name } }, contact };
      } else {
        anyChannelConsentedButUnsendable = true; // consented but can't send freeform now, no template
        continue;
      }
    } else if (channel === "sms") {
      if (!step.content.text) continue;
      sendArgs = { channel, to, body: interpolate(step.content.text, vars), contact };
    }

    // Frequency cap + quiet hours are checked once we KNOW we have a sendable channel, so a
    // capped/quiet contact defers rather than burning the funnel.
    if (await sentThisWeek(sb, contact.id) >= freqCap()) return "deferred";
    if (inQuietHours()) return "deferred";

    await providers.deliver(sendArgs);
    await sb.from("events").insert({
      contact_id: contact.id,
      type: "funnel_sent",
      channel,
      data: { funnel: funnel.key, step: enrollment.current_step, provider: providers.providerFor(channel) },
    });
    return "sent";
  }

  if (anyExplicitUnsub && !anyChannelConsentedButUnsendable) return "exit_unsubscribed";
  return anyChannelConsentedButUnsendable ? "deferred" : "no_channel";
}

// ── enrollment ───────────────────────────────────────────────────────────────
async function enrollFromEvents(sb) {
  const since = iso(Date.now() - ENROLL_LOOKBACK_MIN * 60000);
  const summary = { scanned: 0, enrolled: 0 };

  const { data: events } = await sb
    .from("web_events")
    .select("id, contact_id, name, product_title, url, occurred_at")
    .not("contact_id", "is", null)
    .gte("occurred_at", since)
    .limit(2000);

  for (const ev of events || []) {
    summary.scanned++;
    for (const funnel of FUNNELS) {
      if (!funnel.enabled || funnel.enroll.event !== ev.name) continue;

      // Cooldown: skip if enrolled into this funnel recently (active OR completed).
      const coolSince = iso(Date.now() - (funnel.cooldownDays || 0) * 86400000);
      const { count: recent } = await sb
        .from("funnel_enrollments")
        .select("id", { count: "exact", head: true })
        .eq("contact_id", ev.contact_id)
        .eq("funnel_key", funnel.key)
        .gte("enrolled_at", coolSince);
      if (recent) continue;

      const step0 = funnel.steps[0];
      const { error } = await sb.from("funnel_enrollments").insert({
        contact_id: ev.contact_id,
        funnel_key: funnel.key,
        status: "active",
        current_step: 0,
        next_action_at: iso(Date.now() + parseDelayMs(step0.after)),
        enroll_event_id: ev.id,
        enroll_data: { product: ev.product_title || null, url: ev.url || null },
      });
      // Unique-active index makes a concurrent duplicate fail — that's fine, not an error we surface.
      if (!error) summary.enrolled++;
    }
  }
  return summary;
}

// ── advancement ──────────────────────────────────────────────────────────────
async function advanceDue(sb) {
  const summary = { claimed: 0, sent: 0, completed: 0, converted: 0, exited: 0, deferred: 0, failed: 0 };

  // Claim due enrollments with a lease so overlapping sweeps can't double-send.
  const { data: claimed } = await sb
    .from("funnel_enrollments")
    .update({ status: "processing" })
    .lte("next_action_at", iso(Date.now()))
    .eq("status", "active")
    .select("*")
    .limit(500);

  for (const e of claimed || []) {
    summary.claimed++;
    const funnel = funnelByKey(e.funnel_key);
    try {
      if (!funnel || !funnel.enabled) {
        await finish(sb, e, "failed", "funnel_missing_or_disabled");
        summary.failed++;
        continue;
      }
      if (Date.now() > new Date(e.enrolled_at).getTime() + MAX_FUNNEL_AGE_DAYS * 86400000) {
        await finish(sb, e, "failed", "expired");
        summary.failed++;
        continue;
      }

      const { data: contact } = await sb.from("contacts").select("*").eq("id", e.contact_id).maybeSingle();
      if (!contact) { await finish(sb, e, "failed", "contact_gone"); summary.failed++; continue; }
      if (testOnly() && !isInternalContact(contact)) { await defer(sb, e); summary.deferred++; continue; }

      const step = funnel.steps[e.current_step];
      if (!step) { await finish(sb, e, "completed", null); summary.completed++; continue; }

      const outcome = await runStep(sb, e, funnel, step, contact);
      if (outcome === "exit_unsubscribed") { await finish(sb, e, "exited", "unsubscribed"); summary.exited++; }
      else if (outcome === "deferred" || outcome === "no_channel") { await defer(sb, e); summary.deferred++; }
      else if (outcome === "sent") {
        summary.sent++;
        const nextStep = funnel.steps[e.current_step + 1];
        if (nextStep) {
          await sb.from("funnel_enrollments").update({
            status: "active",
            current_step: e.current_step + 1,
            last_action_at: iso(Date.now()),
            next_action_at: iso(Date.now() + parseDelayMs(nextStep.after)),
          }).eq("id", e.id);
        } else {
          await finish(sb, e, "completed", null);
          summary.completed++;
        }
      }
    } catch (err) {
      console.error(`[funnels] enrollment ${e.id} failed:`, err.message);
      await defer(sb, e).catch(() => {}); // release the lease; retry next sweep
      summary.failed++;
    }
  }
  return summary;
}

async function finish(sb, e, status, reason) {
  await sb.from("funnel_enrollments").update({
    status, exit_reason: reason, last_action_at: iso(Date.now()),
  }).eq("id", e.id);
}
async function defer(sb, e) {
  await sb.from("funnel_enrollments").update({
    status: "active", next_action_at: iso(Date.now() + DEFER_MINUTES * 60000),
  }).eq("id", e.id);
}

/** The whole sweep. Returns a summary for observability. */
async function runSweep() {
  if (!enabled()) return { skipped: "disabled" };
  const sb = getSupabase();
  if (!sb) return { skipped: "no_supabase" };
  const enroll = await enrollFromEvents(sb);
  const advance = await advanceDue(sb);
  return { testOnly: testOnly(), enroll, advance };
}

module.exports = {
  runSweep,
  // exported for tests:
  _internal: { parseDelayMs, interpolate, inQuietHours, whatsappWindowOpen, runStep, enrollFromEvents, advanceDue },
};
