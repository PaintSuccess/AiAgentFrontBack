/**
 * Channel-delivery providers for the funnel engine (L3).
 *
 * The engine ORCHESTRATES (who/when/which channel); DELIVERY of each channel is a swappable
 * provider, because who actually sends is not settled and may change (user direction 22 Jul):
 * email might stay on Omnisend / a plugin or move to our own sender; WA/SMS could later route
 * through a plugin too. Making that a config line — not a rewrite — is the whole point.
 *
 * Provider kinds:
 *   internal        — our own send.js (WA/SMS today). Sequenced: the engine sends it as a step.
 *   external_api    — a plugin we can trigger per-contact via its API. Sequenced. (none wired yet)
 *   native_parallel — a tool that runs its OWN flows (Shopify native email automations, an
 *                     Omnisend workflow). NOT sequenced: it fires on its own rails; the engine
 *                     excludes it from steps so we never double-message.
 *   off             — channel unused.
 *
 * Change the map (or CHANNEL_PROVIDERS env as JSON) to move a channel between providers. Start:
 * WA/SMS = internal, email = native_parallel.
 */
const { cleanEnv } = require("../../shopify");

const DEFAULT_PROVIDERS = {
  whatsapp: "internal",
  sms: "internal",
  email: "native_parallel",
};

const SEQUENCED_KINDS = new Set(["internal", "external_api"]);

function providerMap() {
  const raw = cleanEnv("CHANNEL_PROVIDERS");
  if (raw) {
    try {
      return { ...DEFAULT_PROVIDERS, ...JSON.parse(raw) };
    } catch {
      console.error("[funnels/providers] CHANNEL_PROVIDERS is not valid JSON — using defaults");
    }
  }
  return DEFAULT_PROVIDERS;
}

/** The provider kind for a channel (internal | external_api | native_parallel | off). */
function providerFor(channel) {
  return providerMap()[channel] || "off";
}

/** Can the engine sequence this channel into a chain step (vs it running in parallel elsewhere)? */
function isSequenced(channel) {
  return SEQUENCED_KINDS.has(providerFor(channel));
}

/**
 * Deliver one message on a channel through its provider. Only sequenced providers reach here;
 * a native_parallel/off channel is filtered out before this by the engine.
 *
 * @returns {Promise<{id, status, provider}>}
 */
async function deliver({ channel, contact, to, body, template }) {
  const kind = providerFor(channel);

  if (kind === "internal") {
    // Our own send service — logs to the spine, handles WA templates vs freeform.
    const send = require("../send");
    return send.sendMessage({ channel, to, body, template, author: "ai", contact });
  }

  if (kind === "external_api") {
    // A plugin we trigger per-contact. None wired yet; fail loud rather than silently drop.
    throw new Error(`external_api provider for "${channel}" is configured but not implemented`);
  }

  // native_parallel / off should never be handed to deliver().
  throw new Error(`channel "${channel}" (provider ${kind}) is not sequenceable — engine bug`);
}

module.exports = { providerFor, isSequenced, deliver, DEFAULT_PROVIDERS };
