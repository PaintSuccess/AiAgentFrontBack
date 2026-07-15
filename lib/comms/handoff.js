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

/** @returns {Promise<{notified: number, attempted: number}>} how many staff SMS actually sent. */
async function notifyStaff({ toE164, email, name, channel, reason, method }) {
  const numbers = notifyNumbers();
  if (!numbers.length) return { notified: 0, attempted: 0 };
  const contact = [toE164, email].filter(Boolean).join(" · ") || "no phone/email on file";
  const lines = [
    "🆘 Customer asked for a human.",
    `Channel: ${channel || "unknown"}`,
    `Customer: ${name || "unknown"} (${contact})`,
    reason ? `Reason: ${reason}` : null,
    method === "whatsapp"
      ? "They were given your WhatsApp link — expect a message from them."
      : "Told them you'll follow up by SMS — reply from the Comms Hub or direct.",
  ].filter(Boolean);
  const body = lines.join("\n");
  // Send in parallel. These are real Twilio round-trips (~1-2s each) and they sit
  // inside the caller's timeout budget (the SMS/WhatsApp webhook must ack fast, and
  // the text agent's reply window is only ~11-14s) — doing them sequentially made
  // every extra manager push the customer's reply closer to a timeout. We still
  // await the batch: on serverless, fire-and-forget work can be killed once the
  // response returns, and silently losing the staff page is worse than ~1s.
  const results = await Promise.all(
    numbers.map((to) =>
      twilioSendSms({ to, body })
        .then(() => true)
        .catch((err) => {
          console.error("[handoff] staff notify failed:", err.message);
          return false;
        })
    )
  );
  return { notified: results.filter(Boolean).length, attempted: numbers.length };
}

/**
 * @param {{channel: "voice"|"sms"|"whatsapp"|"chat", phone?: string, name?: string,
 *   reason?: string, preferred?: "whatsapp"|"sms"}} input
 * @returns {Promise<{ok: boolean, method: string, message: string, link: string|null, threadId: string|null}>}
 */
async function escalateToHuman({ channel, phone, email, name, reason, preferred } = {}) {
  const toE164 = normalizeE164(phone);
  // WhatsApp is the default handoff. SMS follow-up needs a number, so if SMS was
  // asked for but we have no phone, fall back to the WhatsApp link (never fail).
  let method = preferred === "sms" ? "sms" : "whatsapp";
  if (method === "sms" && !toE164) method = "whatsapp";

  // Two very different "voice" contexts:
  //   • a real PHONE CALL (Twilio) — has a caller number, no screen → we must TEXT
  //     the link, since a call can't display one.
  //   • a WEBSITE-WIDGET voice chat — no phone number at all (WebRTC in the
  //     browser), but it HAS a screen → we return the link in the message so it
  //     shows on screen. This is the case that used to 400 (no phone on "voice").
  // Heuristic: it's a phone call only when we actually have a number on a voice
  // channel. Never require a phone; never throw for a missing one.
  //
  // Accept BOTH channel vocabularies. The tool schema says "voice", but the system
  // prompt teaches {{channel}} values of website_widget/phone/sms/whatsapp and the
  // conversation-initiation webhook literally sends "phone" for a real call — so an
  // agent that does what the prompt says ("Pass the channel") sends "phone" and this
  // check silently failed, meaning a caller with no screen was handed a wa.me URL in
  // text they were then forbidden to read aloud.
  const normalizedChannel = String(channel || "").trim().toLowerCase() === "phone" ? "voice" : channel;
  const isPhoneCall = normalizedChannel === "voice" && Boolean(toE164);

  const link = method === "whatsapp" ? buildWaLink(reason) : null;

  // Page staff BEFORE composing the reply, so what we tell the customer can reflect
  // what actually happened rather than assert it. notifyStaff swallows per-number send
  // failures (one manager's phone shouldn't sink the escalation) but now reports how
  // many actually went out.
  const staff = await notifyStaff({ toE164, email, name, channel: normalizedChannel, reason, method });
  const staffNotified = staff.notified > 0;

  const CALL_US = "please call 02 5838 5959 and the team will help you straight away";

  // Compose (and, on a phone call, actually deliver) the customer's route to a human
  // FIRST. Whether they can reach anyone is only known once that has been attempted —
  // deciding earlier is how the AI ends up muted for someone who never got the link.
  let customerMessage;
  let linkDelivered = false;
  if (method === "whatsapp") {
    if (!link) {
      customerMessage = staffNotified
        ? "I've let our support team know — they'll follow up with you shortly."
        : `I couldn't reach the team automatically just now — ${CALL_US}.`;
    } else if (isPhoneCall) {
      // Text the link to the caller; don't read a URL aloud. If that text fails, the
      // caller has no way to receive the link at all, so don't claim we sent it — and
      // the link does NOT count as a route to a human.
      linkDelivered = await sendMessage({
        channel: "sms",
        to: toE164,
        body: `Chat with the Paint Access team on WhatsApp: ${link}`,
        author: "system",
      })
        .then(() => true)
        .catch((err) => {
          console.error("[handoff] customer link SMS failed:", err.message);
          return false;
        });
      customerMessage = linkDelivered
        ? "I've just texted you a link to chat with our support team on WhatsApp — tap it and they'll take it from here."
        : `I'm having trouble texting you that link — ${CALL_US}.`;
    } else {
      // Widget (voice or text) / WhatsApp / SMS: the link rides in the returned message
      // itself, so it is in the customer's hands as soon as they read it.
      linkDelivered = true;
      customerMessage = `I've connected you with our support team on WhatsApp — tap this link to chat with them directly: ${link}`;
    }
  } else {
    customerMessage = staffNotified
      ? "I've let our team know — one of them will follow up with you by SMS shortly."
      : `I couldn't reach the team automatically just now — ${CALL_US}.`;
  }

  // Only mute the AI once the customer demonstrably has a way through: the link is in
  // their hands, or staff were actually paged. Otherwise keep answering — a silent
  // thread with nobody coming is worse than an AI that is still trying.
  const reachable = linkDelivered || staffNotified;

  let threadId = null;
  if (toE164 && reachable) {
    threadId = await queries.resolveThreadId({ phone: toE164 });
    if (threadId) await queries.humanTakeoverThread(threadId).catch(() => {});
  }

  if (toE164) {
    await store
      .recordOutbound({
        channel: normalizedChannel === "voice" ? "voice" : normalizedChannel || "chat",
        toPhone: toE164,
        author: "system",
        // Say what actually happened. The AI is only paused when the customer has a
        // real route to a human, and staff paging can partially fail — the inbox is
        // where someone works out why nobody replied, so it must not overstate.
        body:
          `⚑ Escalated to human (${method}).${reason ? ` Reason: ${reason}.` : ""}` +
          ` Staff paged: ${staff.notified}/${staff.attempted}.` +
          (reachable ? " AI paused." : " AI still answering — no staff reached and no handoff link."),
        status: "sent",
      })
      .catch(() => {});
  }

  // On the website widget, the agent should render the handoff on screen (a
  // "Chat on WhatsApp" button) rather than speak/paste a URL — mirror the
  // display_products pattern so the widget's client tool + WS safety-net can fire.
  const next_action_required =
    "If this conversation is in the website widget or browser voice mode, your immediate next tool call MUST be open_whatsapp_handoff using open_whatsapp_handoff_payload, so the WhatsApp button appears on their screen — then tell them to tap it. Do NOT read the link aloud. On SMS or WhatsApp, the link is already in this message; just tell them to tap it.";

  return {
    ok: true,
    method,
    message: customerMessage,
    link,
    threadId,
    open_whatsapp_handoff_payload: link ? { link, reason: reason || null } : null,
    next_action_required,
  };
}

module.exports = { escalateToHuman, isStaffNumber };
