/**
 * Funnel definitions (L3) — declarative, version-controlled. The engine reads these; there is
 * deliberately no DB builder UI yet (see the L3 plan). Adding/editing a funnel is a code review.
 *
 * A funnel:
 *   key           stable id, used in funnel_enrollments.funnel_key
 *   enabled       per-funnel switch (on top of the global ENABLE_FUNNELS kill switch)
 *   enroll        { event, requiresKnownContact, product? } — what web_event enrolls a contact
 *   cooldownDays  don't re-enroll the same contact into this funnel within N days
 *   exitOn        conditions that end the journey early (checked before every step)
 *   steps[]       { after, channels[], content } — the chain
 *
 * A step's `content` is one of:
 *   { text: "...{{name}}...{{product}}..." }        interpolated static copy
 *   { template: "reengage_offer", variables: {} }   an approved WhatsApp template (works outside 24h)
 *   { ai: "prompt for the agent" }                  AI-drafted per contact (freeform; inside 24h only)
 *
 * `channels` is an ordered preference; the engine picks the first that is consented, addressable,
 * sendable (WA: window open for freeform, or a template available), and whose provider it can
 * sequence (see providers.js — email is native_parallel today, so it's skipped here on purpose).
 *
 * STARTING COPY IS PLACEHOLDER — real copy is drafted/approved before the funnels are switched on.
 */
module.exports = [
  {
    key: "browse_abandon",
    name: "Browse abandonment",
    enabled: true,
    enroll: { event: "product_viewed", requiresKnownContact: true },
    cooldownDays: 7,
    exitOn: ["unsubscribed"], // purchase-exit + conversion lands in L3.2
    steps: [
      {
        after: "3h",
        channels: ["whatsapp", "sms"],
        content: {
          text: "Hi {{name}}, still thinking about {{product}}? Happy to answer any questions or check stock for you.",
        },
      },
    ],
  },
  {
    key: "cart_abandon",
    name: "Cart abandonment",
    enabled: true,
    enroll: { event: "product_added_to_cart", requiresKnownContact: true },
    cooldownDays: 7,
    exitOn: ["unsubscribed"],
    steps: [
      {
        after: "1h",
        channels: ["whatsapp", "sms"],
        content: {
          text: "Hi {{name}}, you left {{product}} in your cart. Want a hand finishing the order, or have a question first?",
        },
      },
    ],
  },
  {
    key: "win_back",
    name: "Win-back (inactive)",
    enabled: true,
    // Enrolls on a return visit after a gap — a light proxy for "was away, came back".
    // A pure time-based "inactive N days" trigger (no event) is a later refinement.
    enroll: { event: "page_viewed", requiresKnownContact: true },
    cooldownDays: 30,
    exitOn: ["unsubscribed"],
    steps: [
      {
        after: "6h",
        channels: ["whatsapp", "sms"],
        content: {
          // Outside the 24h WhatsApp window this needs a template; the engine falls back to it.
          template: "reengage_offer",
          text: "Hi {{name}}, good to see you back at Paint Access. Anything we can help you find today?",
        },
      },
    ],
  },
];
