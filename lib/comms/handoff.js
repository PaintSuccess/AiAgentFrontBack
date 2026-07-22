/**
 * Cross-channel "connect me to a human" escalation.
 * One function reused by every AI-run channel (voice / SMS / WhatsApp / chat widget)
 * via a single ElevenLabs server tool (`escalate_to_human`). Never transfers a phone
 * call — voice customers get texted instead, per requirement.
 *
 * Two methods, selected by the HANDOFF_METHOD env (see _store/docs/PLAN-HumanHandoff.md):
 *   unset / "link" — Option 1: wa.me deep-link to HUMAN_SUPPORT_WA_NUMBER.
 *   "relay"        — Option 3: lib/comms/relay.js mirrors the customer's existing
 *                    thread to staff phones; the customer never leaves their chat.
 *                    Any relay-open failure falls back to Option 1 — an escalation
 *                    must never fail outright.
 * (Option 2 — Meta Groups API — investigated 2026-07-22 and blocked on the
 * green-tick OBA requirement; see the plan doc.)
 */
const crypto = require("crypto");
const { cleanEnv } = require("../shopify");
const { normalizeE164 } = require("../whatsapp");
const { sendMessage, twilioSendSms } = require("./send");
const store = require("./store");
const queries = require("./queries");
const relay = require("./relay");

// Short-lived signed token handed to the website widget when it offers phone
// capture (Option C). The public /api/comms/handoff-callback endpoint pages real
// staff, so it must not be an open door: a valid token proves the request came
// from a genuine escalation this backend just issued, not a random script. HMAC
// over the expiry with API_SECRET_TOKEN — stateless, no storage needed.
const HANDOFF_TOKEN_TTL_MS = 15 * 60 * 1000;
function mintHandoffToken() {
  const secret = cleanEnv("API_SECRET_TOKEN");
  if (!secret) return null;
  const exp = String(Date.now() + HANDOFF_TOKEN_TTL_MS);
  const sig = crypto.createHmac("sha256", secret).update(exp).digest("base64url");
  return `${exp}.${sig}`;
}
function verifyHandoffToken(token) {
  const secret = cleanEnv("API_SECRET_TOKEN");
  if (!secret || !token) return false;
  const parts = String(token).split(".");
  if (parts.length !== 2) return false; // strict `exp.sig` — no trailing junk
  const [exp, sig] = parts;
  if (!/^\d+$/.test(exp) || !/^[A-Za-z0-9_-]+$/.test(sig) || Date.now() > Number(exp)) return false;
  const expected = crypto.createHmac("sha256", secret).update(exp).digest("base64url");
  if (expected.length !== sig.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
  } catch {
    return false;
  }
}

/** The signature segment — a stable unique id for a token, used to make a token
 *  single-use at the callback (consume once, reject replays). */
function handoffTokenId(token) {
  return String(token || "").split(".")[1] || "";
}

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

function buildWaLink(reason, { forceLink = false } = {}) {
  // Relay mode points the link at the BUSINESS number: the customer's tap opens a
  // thread with us, the pre-filled text below matches looksLikeHumanHandoffIntent
  // (elevenlabs-text.js), so their first message deterministically re-escalates
  // with a phone number attached and the relay opens. In link mode the link keeps
  // going to Daniel's separate support number, exactly as before.
  // `forceLink` is set when a relay open just FAILED: the business-number link
  // would only re-trigger the same failing escalation in a loop, so the fallback
  // must go straight to Daniel's number even while the relay flag is on.
  if (!forceLink && relay.relayEnabled()) {
    const business = digitsOnly(cleanEnv("TWILIO_WHATSAPP_NUMBER") || cleanEnv("HUMAN_SUPPORT_WA_NUMBER"));
    if (!business) return null;
    const text = `Hi Paint Access — I'd like to speak with a human, please.${reason ? ` (about: ${reason})` : ""}`;
    return `https://wa.me/${business}?text=${encodeURIComponent(text)}`;
  }
  const number = digitsOnly(cleanEnv("HUMAN_SUPPORT_WA_NUMBER"));
  if (!number) return null;
  const text = reason
    ? `Hi, I was talking to the Paint Access AI assistant and need help — ${reason}`
    : "Hi, I was talking to the Paint Access AI assistant and asked to speak with a person.";
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

/** @returns {Promise<{notified: number, attempted: number}>} how many staff SMS actually sent. */
async function notifyStaff({ toE164, email, name, channel, reason, method, threadId = null }) {
  const numbers = notifyNumbers();
  if (!numbers.length) return { notified: 0, attempted: 0 };
  const contact = [toE164, email].filter(Boolean).join(" · ") || "no phone/email on file";
  const adminLink = relay.adminThreadLink(threadId);
  const lines = [
    "🆘 Customer asked for a human.",
    `Channel: ${channel || "unknown"}`,
    `Customer: ${name || "unknown"} (${contact})`,
    reason ? `Reason: ${reason}` : null,
    method === "whatsapp"
      ? "They were given your WhatsApp link — expect a message from them."
      : "Told them you'll follow up by SMS — reply from the Comms Hub or direct.",
    adminLink ? `📋 Admin: ${adminLink}` : null,
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

  const CALL_US = "please call 02 5838 5959 and the team will help you straight away";

  // Resolved early so staff alerts (both methods) can carry the admin deep link,
  // and so the relay can bind to the customer's thread.
  let threadId = toE164 ? await queries.resolveThreadId({ phone: toE164 }) : null;
  let relayFellBack = false;

  // ---- Option 3: relay handoff (HANDOFF_METHOD=relay) ------------------------
  // Needs a phone to bind the customer leg. A widget chat with no phone falls
  // through to the link method below — whose wa.me link is relay-aware (see
  // buildWaLink): it brings the customer onto the BUSINESS number, where their
  // first message re-escalates WITH a phone number and the relay opens.
  if (relay.relayEnabled() && toE164) {
    if (!threadId) {
      // Voice callers may never have texted us — seed the thread so the relay
      // (and the hub transcript) has somewhere to live.
      const seeded = await store
        .recordOutbound({
          channel: normalizedChannel === "voice" ? "voice" : normalizedChannel || "chat",
          toPhone: toE164,
          author: "system",
          body: "⚑ Customer asked for a human — opening team relay.",
          status: "sent",
        })
        .catch(() => null);
      threadId = seeded?.thread?.id || null;
    }
    const opened = threadId
      ? await relay.openRelay({ threadId, phone: toE164, name, email, channel: normalizedChannel, reason })
      : null;
    if (opened) {
      const isTextChannel = normalizedChannel === "sms" || normalizedChannel === "whatsapp";
      let customerMessage;
      if (isTextChannel) {
        // They are already in the thread staff will answer into — nothing to tap.
        customerMessage =
          "You're through to our team now — a real person will reply right here in this chat shortly.";
      } else {
        // Phone call / widget with a phone: open the customer leg with a text so
        // they have a thread to reply into.
        const openerSent = await sendMessage({
          channel: opened.relay.customer_channel,
          to: toE164,
          body:
            "Hi, it's the Paint Access team. You asked to speak with a person — reply to this message any time and we'll take it from here.",
          author: "system",
        })
          .then(() => true)
          .catch((err) => {
            console.error("[handoff] relay opener failed:", err.message);
            return false;
          });
        customerMessage = openerSent
          ? "I've just sent you a text from our number — reply to it and a real person from our team will take it from there."
          : opened.notified > 0
            ? "Our team has been notified and will contact you shortly."
            : `I couldn't reach the team automatically just now — ${CALL_US}.`;
      }
      return {
        ok: true,
        method: "relay",
        relay_tag: opened.relay.tag,
        message: customerMessage,
        link: null,
        threadId,
        open_whatsapp_handoff_payload: null,
        next_action_required:
          "Tell the customer exactly the message above, then stop handling this conversation — a human has taken over. Do not mention or read any links and do not call other tools for this request.",
      };
    }
    // Relay could not open (migration missing, DB down…) — degrade to the
    // deep-link method below rather than failing the escalation.
    console.error("[handoff] relay open failed — falling back to deep-link handoff.");
    relayFellBack = true;
  }

  const link = method === "whatsapp" ? buildWaLink(reason, { forceLink: relayFellBack }) : null;

  // A real phone call has no screen, so the caller's only route is an SMS'd link. Kick
  // that off CONCURRENTLY with paging staff — they are independent Twilio round-trips.
  // Running them serially (page staff, THEN text the caller) made escalate slow enough
  // that ElevenLabs cancelled the tool the moment the caller spoke over the "connecting
  // you now" filler, and the caller then got NO handoff at all (3-day audit ending
  // 2026-07-20: conv_5001 cancelled 4x, conv_9201 abandoned before completion). Running
  // them in parallel ~halves the tool's wall time so it settles before an interruption
  // can abandon it. Both are still awaited (fire-and-forget dies on serverless), just
  // not one-after-the-other.
  const mustTextCaller = method === "whatsapp" && Boolean(link) && isPhoneCall;
  const [callerLinkSent, staff] = await Promise.all([
    mustTextCaller
      ? sendMessage({
          channel: "sms",
          to: toE164,
          body: `Chat with the Paint Access team on WhatsApp: ${link}`,
          author: "system",
        })
          .then(() => true)
          .catch((err) => {
            console.error("[handoff] customer link SMS failed:", err.message);
            return false;
          })
      : Promise.resolve(false),
    notifyStaff({ toE164, email, name, channel: normalizedChannel, reason, method, threadId }),
  ]);
  const staffNotified = staff.notified > 0;

  // Compose the customer's route to a human from what actually happened above. Both the
  // link SMS (phone only) and the staff page have already been attempted concurrently,
  // so this asserts nothing it can't back up.
  let customerMessage;
  let linkDelivered = false;
  if (method === "whatsapp") {
    if (!link) {
      customerMessage = staffNotified
        ? "I've let our support team know — they'll follow up with you shortly."
        : `I couldn't reach the team automatically just now — ${CALL_US}.`;
    } else if (isPhoneCall) {
      // We texted the link to the caller (never read a URL aloud). If that text failed,
      // the caller has no way to receive the link, so don't claim we sent it — and it
      // does NOT count as a route to a human.
      linkDelivered = callerLinkSent;
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

  if (toE164 && reachable) {
    if (!threadId) threadId = await queries.resolveThreadId({ phone: toE164 });
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

  // Option C — website widget with no phone on file, relay enabled: alongside the
  // WhatsApp button the widget can offer "leave your mobile and we'll text you".
  // We hand it a signed token so its callback (which pages staff) is trusted. In
  // link mode there's no relay for a texted number to open, so we don't offer it.
  const offerPhoneCapture = relay.relayEnabled() && !toE164 && Boolean(link);
  const handoffPayload = link
    ? {
        link,
        reason: reason || null,
        ...(offerPhoneCapture ? { allow_phone_capture: true, handoff_token: mintHandoffToken() } : {}),
      }
    : null;

  return {
    ok: true,
    method,
    message: customerMessage,
    link,
    threadId,
    open_whatsapp_handoff_payload: handoffPayload,
    next_action_required,
  };
}

module.exports = { escalateToHuman, isStaffNumber, mintHandoffToken, verifyHandoffToken, handoffTokenId };
