/**
 * Cross-channel "connect me to a human" escalation — Option 1 (deep-link handoff).
 * One function reused by every AI-run channel (voice / SMS / WhatsApp / chat widget)
 * via a single ElevenLabs server tool (`escalate_to_human`). Never transfers a phone
 * call — voice customers get texted the handoff link instead, per requirement.
 *
 * Option 2 (auto-created WhatsApp group, no AI) is documented but not built —
 * see _store/docs/PLAN-HumanHandoff.md. This module is written so Option 2 can be
 * dropped in later as a second `method` without changing callers.
 */
const { cleanEnv } = require("../shopify");
const { normalizeE164 } = require("../whatsapp");
const { sendMessage, twilioSendSms } = require("./send");
const store = require("./store");
const queries = require("./queries");

function digitsOnly(v) {
  return String(v || "").replace(/\D/g, "");
}

function notifyNumbers() {
  return cleanEnv("HUMAN_SUPPORT_NOTIFY_NUMBERS")
    .split(",")
    .map((s) => normalizeE164(s.trim()))
    .filter(Boolean);
}

/**
 * True if `phone` is a known staff/support number (Daniel, managers, the
 * handoff WhatsApp number) rather than a customer. Inbound SMS/WhatsApp
 * webhooks must check this FIRST and skip the AI + customer-thread pipeline
 * entirely — otherwise a staff reply to a handoff alert gets answered by the
 * customer-facing AI like any other inbound message (real bug, caught in
 * testing 2026-07-15: Daniel replied to a test alert and the AI answered him).
 */
function isStaffNumber(phone) {
  const e164 = normalizeE164(phone);
  if (!e164) return false;
  const staffSet = new Set([...notifyNumbers(), normalizeE164(cleanEnv("HUMAN_SUPPORT_WA_NUMBER"))]);
  return staffSet.has(e164);
}

function buildWaLink(reason) {
  const number = digitsOnly(cleanEnv("HUMAN_SUPPORT_WA_NUMBER"));
  if (!number) return null;
  const text = reason
    ? `Hi, I was talking to the Paint Access AI assistant and need help — ${reason}`
    : "Hi, I was talking to the Paint Access AI assistant and asked to speak with a person.";
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

async function notifyStaff({ toE164, name, channel, reason, method }) {
  const numbers = notifyNumbers();
  if (!numbers.length) return;
  const lines = [
    "🆘 Customer asked for a human.",
    `Channel: ${channel}`,
    `Customer: ${name || "unknown"}${toE164 ? ` ${toE164}` : " (no phone on file)"}`,
    reason ? `Reason: ${reason}` : null,
    method === "whatsapp"
      ? "They were given your WhatsApp link."
      : "Told them you'll follow up by SMS — reply from the Comms Hub or direct.",
  ].filter(Boolean);
  const body = lines.join("\n");
  for (const to of numbers) {
    await twilioSendSms({ to, body }).catch((err) =>
      console.error("[handoff] staff notify failed:", err.message)
    );
  }
}

/**
 * @param {{channel: "voice"|"sms"|"whatsapp"|"chat", phone?: string, name?: string,
 *   reason?: string, preferred?: "whatsapp"|"sms"}} input
 * @returns {Promise<{ok: boolean, method: string, message: string, link: string|null, threadId: string|null}>}
 */
async function escalateToHuman({ channel, phone, name, reason, preferred } = {}) {
  const toE164 = normalizeE164(phone);
  const method = preferred === "sms" ? "sms" : "whatsapp";

  if (channel === "voice" && !toE164) {
    const err = new Error("A phone number is required to escalate a voice call.");
    err.statusCode = 400;
    throw err;
  }
  if (method === "sms" && !toE164) {
    const err = new Error("A phone number is required for SMS follow-up.");
    err.statusCode = 400;
    throw err;
  }

  let threadId = null;
  if (toE164) {
    threadId = await queries.resolveThreadId({ phone: toE164 });
    if (threadId) await queries.humanTakeoverThread(threadId).catch(() => {});
  }

  let customerMessage;
  let link = null;
  if (method === "whatsapp") {
    link = buildWaLink(reason);
    customerMessage = link
      ? `I've connected you with our support team on WhatsApp — tap this link to chat with them directly: ${link}`
      : "I've let our support team know — they'll reach out shortly.";
    // Voice can't display a link mid-call, so text it to the customer instead.
    if (channel === "voice" && link) {
      await sendMessage({ channel: "sms", to: toE164, body: customerMessage, author: "system" }).catch(
        (err) => console.error("[handoff] customer link SMS failed:", err.message)
      );
    }
  } else {
    customerMessage = "I've let our team know — one of them will follow up with you by SMS shortly.";
  }

  await notifyStaff({ toE164, name, channel, reason, method });

  if (toE164) {
    await store
      .recordOutbound({
        channel: channel === "voice" ? "voice" : channel,
        toPhone: toE164,
        author: "system",
        body: `⚑ Escalated to human (${method}).${reason ? ` Reason: ${reason}.` : ""} AI paused.`,
        status: "sent",
      })
      .catch(() => {});
  }

  return { ok: true, method, message: customerMessage, link, threadId };
}

module.exports = { escalateToHuman, isStaffNumber };
