const { cleanEnv } = require("./shopify");
const productSearchApi = require("../api/shopify/products");
const {
  agentAskedForOrderDetails,
  extractEmail,
  extractOrderNumber,
  hasExplicitOrderReference,
  looksLikeOrderIntent,
  lookupCustomerOrder,
} = require("./customer-order-lookup");

const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";

// Model per channel. The agent-level llm is tuned for VOICE, where latency is the whole
// game — a phone caller hears every second of thinking, so Haiku earns its place there.
// Text does not have that constraint: SMS/WhatsApp turns run to a 11-14s budget, which
// comfortably fits a stronger model that reasons better about tools and ambiguous asks.
//
// Env-gated on purpose: unset => no override, the agent default (Haiku) governs every
// channel exactly as before. So this is reverted by clearing one Vercel variable, with no
// deploy and no code change. Valid ids come from ElevenLabs' own list (POST
// /v1/convai/llm-usage/calculate) — e.g. claude-sonnet-4-6. Note "claude-sonnet-5" is NOT
// offered by ConvAI; setting an invalid id makes the agent fail to start a conversation.
//
// Requires platform_settings.overrides.conversation_config_override.agent.prompt.llm to
// be true on the agent, or ElevenLabs silently ignores this — see
// _store/setup/set-channel-llm.js.
const TEXT_CHANNEL_LLM = cleanEnv("TEXT_CHANNEL_LLM");
// Twilio's messaging webhook gives up and retries around 15s. If our own timeout is
// longer than that, a slow turn gets processed twice: once when Twilio retries the
// webhook, and again when this timeout eventually fires — producing duplicate replies
// to the customer. Keep this comfortably under that window.
const DEFAULT_TIMEOUT_MS = 11000;
const NORMAL_REPLY_SETTLE_MS = 1400;
const TOOL_REPLY_SETTLE_MS = 6500;
const PRODUCT_URL_RE = /https?:\/\/(?:www\.)?paintaccess\.com\.au\/products\/[^\s)\]]+/i;
const DIRECT_SEARCH_STOP_WORDS = new Set([
  "can", "could", "would", "please", "pls", "get", "send", "show", "grab",
  "give", "need", "want", "find", "look", "looking", "link", "links", "url",
  "urls", "product", "products", "one", "too", "also", "same", "other", "that",
  "this", "for", "with", "without", "about", "the", "and", "or", "are", "you",
  "your", "me", "my", "i", "im", "a", "an", "to", "of", "in", "on", "it", "from",
  "hi", "hello", "hey", "here", "there", "help", "red", "black", "white",
  "blue", "green", "yellow", "clear", "only", "not", "just", "codex",
  "live", "test", "interest", "interested", "share", "paint", "access",
  "paintaccess", "whatsapp", "support", "chat", "business", "yeah", "yes",
  "yep", "sure", "suggestion", "suggestions", "recommend", "recommendation",
  "recommendations", "suggest", "suuggestion", "buy", "purchase", "could",
  "asked", "ask",
]);
const PRODUCT_FOLLOWUP_RE =
  /\b(link|links|url|send|get|grab|black|white|red|blue|that one|this one|same one|other one|one too|wheeled|backpack|compact|cart|sprayers?|brush(?:es)?|cutter|oval|kit)\b/i;
const PRODUCT_KEYWORD_RE =
  /\b(link|links|url|urls|product|products|recommend|recommendation|price|stock|available|buy|sprayers?|paints?|kit|coating|roller|sander|primer|tape|brush(?:es)?|cutter|oval|graco|dan|dans|rust|oleum|wagner|masking|floor|epoxy)\b/i;

async function getSignedUrl(agentId, apiKey) {
  const url = `${ELEVENLABS_BASE}/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`;
  const response = await fetch(url, {
    headers: { "xi-api-key": apiKey },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`ElevenLabs signed URL failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  if (!data.signed_url) {
    throw new Error("ElevenLabs signed URL response did not include signed_url");
  }

  return data.signed_url;
}

function getWebSocketCtor() {
  if (typeof WebSocket === "function") return WebSocket;

  try {
    return require("ws");
  } catch {
    throw new Error("No WebSocket implementation available");
  }
}

function sendJson(ws, payload) {
  ws.send(JSON.stringify(payload));
}

function parseToolParams(call = {}) {
  const raw =
    call.parameters ||
    call.arguments ||
    call.input ||
    call.params ||
    call.request_body ||
    {};

  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  return raw && typeof raw === "object" ? raw : {};
}

async function runTextChannelTool(call = {}) {
  const toolName = call.tool_name || call.name || "";
  const params = parseToolParams(call);

  if (toolName === "search_products") {
    const query = String(params.query || params.product_name || "").trim();
    const collection = String(params.collection || "").trim();

    let pool = [];
    if (query) {
      pool = (await productSearchApi.searchProducts(query)).products || [];
    } else if (collection) {
      pool = await productSearchApi.searchByCollection(collection);
    }

    if (!pool.length) {
      return {
        found: false,
        query: query || null,
        collection: collection || null,
        message: `No products found matching "${query || collection}".`,
      };
    }

    const products = pool
      .slice(0, productSearchApi.RESULT_LIMIT || 5)
      .map(productSearchApi.shapeProduct);

    return {
      found: true,
      query: query || null,
      collection: collection || null,
      summary: {
        total: products.length,
        in_stock: products.filter((p) => p.available).length,
      },
      products,
    };
  }

  if (toolName === "display_products_in_chat") {
    return "SMS has no product-card UI. Include a very short product summary and direct links in the text reply.";
  }

  if (toolName === "send_sms_notification") {
    return "Do not send a separate SMS from SMS or WhatsApp channels. Reply directly in the current text channel with the requested product links or details.";
  }

  if (toolName === "end_conversation" || toolName === "end_call") {
    return "Conversation ending.";
  }

  return "Client-side browser tool is not available in SMS or WhatsApp.";
}

function compactReply(text) {
  return String(text || "")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 1500);
}

function normalizeTextMessageLinks(text) {
  return String(text || "")
    .replace(
    /\[([^\]]{1,120})\]\((https?:\/\/(?:www\.)?paintaccess\.com\.au\/products\/[^)\s]+)\)/gi,
    "$1: $2"
    )
    .replace(
      /https?:\/\/paintaccess\.com\.au\/products\//gi,
      "https://www.paintaccess.com.au/products/"
    )
    .replace(
      /(https:\/\/www\.paintaccess\.com\.au\/products\/[A-Za-z0-9_-]+)[.,;:!?]+(?=\s|$)/g,
      "$1"
    );
}

function mentionsWebsiteProductUi(text) {
  const normalized = String(text || "").toLowerCase();
  return (
    normalized.includes("on your screen") ||
    normalized.includes("product card") ||
    normalized.includes("product popup") ||
    normalized.includes("in the popup") ||
    normalized.includes("displayed")
  );
}

// ── "Get me a human" intent (SMS/WhatsApp) ───────────────────────────────────
// Deliberately TIGHT. A false positive pages Daniel for nothing, so every branch
// requires an explicit request (an ask verb + "me", or "speak/talk to <person>"),
// never a bare mention of "team"/"someone". Recall doesn't need to be perfect:
// anything this misses still reaches the LLM, which can call escalate_to_human —
// and that result is now captured by collectHandoffToolResults() as a backstop.
const HUMAN_TARGET =
  "(?:human being|human|real person|live person|person|someone|somebody|agent|operator|manager|consultant|representative|rep|staff|team|support team)";
const HUMAN_REQUEST_RES = [
  // "connect me with the human", "put me through to a manager", "transfer me to an agent"
  new RegExp(`\\b(?:connect|put|transfer|forward|escalate|pass)\\s+me\\b[^.!?]{0,30}?\\b${HUMAN_TARGET}\\b`, "i"),
  // "can I talk to a human", "I'd like to speak with someone"
  new RegExp(`\\b(?:speak|talk|chat|deal)\\s+(?:to|with)\\s+[^.!?]{0,15}?\\b${HUMAN_TARGET}\\b`, "i"),
  // "I need a human", "get me a real person" — narrower target set: "team"/"someone"
  // are excluded here because "I need a sprayer for my team" must not escalate.
  /\b(?:i (?:want|need)|i'?d like|get me|can i get|give me)\b[^.!?]{0,20}?\b(?:human being|human|real person|live person|agent|operator|manager|representative)\b/i,
];
function looksLikeHumanHandoffIntent(text) {
  const t = String(text || "");
  // "Are you a human?" / "is this a bot?" ask ABOUT us — not a request for a person.
  if (/\b(?:are|r)\s+(?:you|u)\b[^.!?]{0,20}\b(?:human|person|bot|robot|ai|real)\b/i.test(t)) return false;
  if (/\b(?:is\s+this|am i (?:talking|speaking) (?:to|with))\b[^.!?]{0,20}\b(?:a\s+)?(?:bot|robot|ai|human|person|real)\b/i.test(t)) return false;
  return HUMAN_REQUEST_RES.some((re) => re.test(t));
}

/**
 * Deterministic human handoff for SMS/WhatsApp — same idea as
 * deterministicTextOrderReply: when the intent is unambiguous, do the work
 * ourselves and answer directly instead of routing through the LLM.
 *
 * Why: the LLM path only delivers the handoff link if the model chooses to repeat
 * it in a follow-up message. In the live 2026-07-15 WhatsApp test it didn't —
 * escalate_to_human ran (staff paged), the model emitted no text, the turn timed
 * out and the customer got the generic fallback with NO link. Escalation is too
 * important to leave to model discretion, so we short-circuit it.
 *
 * Returns "" to fall through to the LLM (unclear intent, or the escalation threw).
 */
async function deterministicHumanHandoffReply({
  text,
  channel,
  customerPhone = "",
  customerName = "",
  customerEmail = "",
}) {
  if (channel !== "sms" && channel !== "whatsapp") return "";
  if (!looksLikeHumanHandoffIntent(text)) return "";

  try {
    const { escalateToHuman } = require("./comms/handoff");
    const result = await escalateToHuman({
      channel,
      phone: customerPhone,
      name: customerName,
      email: customerEmail,
      // The customer's own words beat an LLM paraphrase — this lands in Daniel's
      // alert and in the wa.me pre-filled message.
      reason: String(text || "").replace(/\s+/g, " ").trim().slice(0, 180),
    });
    return compactReply(result?.message || "");
  } catch (err) {
    console.error("[TextChannelHandoff] escalation failed:", err.message);
    return ""; // fall through to the LLM rather than leaving them with nothing
  }
}

// A tool preface is a SHORT filler said before doing work ("let me check that for you"),
// where standing in with a product summary is right because there is no answer yet.
//
// The length gate matters: these patterns match on words like "no worries" + "check",
// which occur naturally inside real answers. A 400-char troubleshooting answer that opens
// "No worries, that's a common issue — check the inlet valve..." is NOT a preface, and
// classifying it as one throws the answer away. That is exactly what happened once the
// soft-timeout filler ("One sec, just checking that for you.") began prepending itself to
// genuine replies: every KB answer suddenly looked like a preface and got replaced with an
// unrelated product list. Substantive length is the signal that the model actually said
// something.
const TOOL_PREFACE_MAX_CHARS = 160;

function looksLikeToolPreface(text) {
  const normalized = String(text || "").toLowerCase().trim();
  if (normalized.length > TOOL_PREFACE_MAX_CHARS) return false;
  return (
    // The agent announcing its OWN imminent action: "let me check", "I'll search",
    // "just grabbing that". The first-person binding is what separates a preface from an
    // answer that merely contains the word "check" — the old pattern paired openers like
    // "no worries" with a verb up to 80 chars away, so "No worries — check the inlet valve
    // first" read as a preface and the real advice was discarded.
    /\b(let me|i'?ll|i will|i'?m|i am|just|one sec|one moment|hang on)[\s,]+(?:go |quickly |now )?(search|check|look|find|confirm|grab|get|pull)\w*/.test(normalized) ||
    /\b(searching|checking our stock|looking that up|grabbing that link|getting that link)\b/.test(normalized) ||
    // Handoff prefaces ("Connecting you now", "One moment"). Without these the
    // reply settles after NORMAL_REPLY_SETTLE_MS (1.4s) — far too fast for
    // escalate_to_human, which does a real Twilio SMS to staff before returning.
    /\b(connecting you|connecting now|putting you through|one moment|hold on)\b/.test(normalized)
  );
}

/**
 * Pull an escalate_to_human result out of an ElevenLabs WS frame.
 *
 * Why this exists: on SMS/WhatsApp the handoff link lives ONLY inside the tool
 * result, and we relied on the LLM to compose a follow-up message repeating it.
 * It frequently doesn't (its pre-tool speech is a voice-only filler that never
 * becomes a text response part), so the turn ended with no reply, timed out, and
 * the customer got the generic fallback with NO link — while staff had already
 * been notified. Capturing the result lets us answer from it directly, mirroring
 * how product tool results are handled.
 */
function collectHandoffToolResults(value, results = [], seen = new WeakSet()) {
  if (value == null) return results;

  if (typeof value === "string") {
    if (!value.includes("wa.me") && !value.includes("open_whatsapp_handoff_payload")) return results;
    try {
      collectHandoffToolResults(JSON.parse(value), results, seen);
    } catch {}
    return results;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectHandoffToolResults(item, results, seen);
    return results;
  }

  if (typeof value !== "object") return results;
  if (seen.has(value)) return results;
  seen.add(value);

  if (value.ok === true && typeof value.link === "string" && /wa\.me\//i.test(value.link) && value.message) {
    results.push(value);
  }

  for (const key of Object.keys(value)) {
    collectHandoffToolResults(value[key], results, seen);
  }
  return results;
}

function formatProductSummaryFromToolResult(value) {
  if (!value) return "";

  let payload = value;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      return "";
    }
  }

  const products = Array.isArray(payload?.products) ? payload.products : [];
  if (!products.length) return "";

  const lines = products.slice(0, 3).map((p, i) => {
    const name = p.name || p.title || "Product";
    const price = p.price ? ` - ${p.price}` : "";
    const stock = p.available === true ? " - in stock" : p.available === false ? " - not showing in stock" : "";
    const url = p.url ? `\n${p.url}` : "";
    return `${i + 1}. ${name}${price}${stock}${url}`;
  });

  return compactReply(`I found these options:\n${lines.join("\n")}`);
}

function productAvailabilityNote(productToolResult) {
  const products = Array.isArray(productToolResult?.products) ? productToolResult.products : [];
  if (!products.length) return "";

  const unavailable = products.filter((p) => p.available === false).length;
  const available = products.filter((p) => p.available === true).length;

  if (unavailable && !available) {
    return "Stock note: these listed products are currently unavailable online. Contact Paint Access to confirm restock timing or alternatives.";
  }

  if (unavailable && available) {
    return "Stock note: some listed products are currently unavailable online; check each product page or contact Paint Access before ordering.";
  }

  return "";
}

function allProductsUnavailable(productToolResult) {
  const products = Array.isArray(productToolResult?.products) ? productToolResult.products : [];
  return products.length > 0 && products.every((p) => p.available === false);
}

function normalizeProductKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/['’]\s*s\b/g, "s")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function directSearchTokens(text) {
  return normalizeProductKey(text)
    .split(/\s+/)
    .filter((token) => token.length > 1 && !DIRECT_SEARCH_STOP_WORDS.has(token));
}

function looksLikeDirectProductRequest(text) {
  const normalized = String(text || "").toLowerCase();
  const tokens = directSearchTokens(text);

  if (
    /\b(hi|hello|hey)\b/.test(normalized) &&
    /\b(paint\s*access|paintaccess|whatsapp support chat|support chat)\b/.test(normalized) &&
    tokens.length === 0
  ) {
    return false;
  }

  if (PRODUCT_KEYWORD_RE.test(normalized)) {
    return true;
  }

  return (
    /\b(get|find|looking|need|want|show|send|grab)\b/i.test(normalized) &&
    tokens.length >= 2
  );
}

function compactProductQuery(text) {
  const tokens = directSearchTokens(text);
  return tokens.join(" ").trim();
}

function extractProductQueryCandidates(text) {
  const normalized = String(text || "")
    .replace(/\b(?:and\s+also|also|plus|as well as)\b/gi, "\n")
    .replace(/\b(?:i\s+i|i)\b/gi, " i ");

  const candidates = [];
  for (const part of normalized.split(/\r?\n|[?!.;]+/)) {
    const raw = part.trim();
    if (!raw) continue;
    if (!looksLikeDirectProductRequest(raw)) continue;

    const query = compactProductQuery(raw);
    if (!query) continue;
    candidates.push({ query, source: raw });
  }

  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = normalizeProductKey(candidate.query);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 4);
}

function tokenMatchesName(token, productName) {
  if (!token || !productName) return false;
  if (productName.includes(token)) return true;
  if (token.endsWith("s") && token.length > 3) {
    return productName.includes(token.slice(0, -1));
  }
  return false;
}

function productResultMatchesText(text, productToolResult) {
  const products = Array.isArray(productToolResult?.products) ? productToolResult.products : [];
  const tokens = directSearchTokens(text);
  if (!products.length || !tokens.length) return false;

  const productNames = products
    .slice(0, 3)
    .map((p) => normalizeProductKey(`${p.name || ""} ${p.vendor || ""}`))
    .join(" ");
  const matches = tokens.filter((token) => tokenMatchesName(token, productNames));
  return matches.length >= Math.min(2, tokens.length);
}

async function inferProductToolResultFromDirectRequest(text) {
  if (!looksLikeDirectProductRequest(text)) return null;

  const candidates = extractProductQueryCandidates(text);
  if (!candidates.length) return null;

  try {
    const perQueryLimit = candidates.length > 1 ? 2 : productSearchApi.RESULT_LIMIT || 5;
    const results = await Promise.all(
      candidates.map(async (candidate) => {
        const result = await productSearchApi.searchProducts(candidate.query);
        return {
          query: candidate.query,
          products: (result.products || [])
            .slice(0, perQueryLimit)
            .map((product) => ({
              ...productSearchApi.shapeProduct(product),
              requestedQuery: candidate.query,
            })),
        };
      })
    );

    const seen = new Set();
    const products = [];
    for (const result of results) {
      for (const product of result.products) {
        const key = product.url || product.name;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        products.push(product);
      }
    }

    return products.length ? { found: true, products, queries: results.map((r) => r.query) } : null;
  } catch (err) {
    console.error("[TextChannelTool] Direct product inference error:", err.message);
    return null;
  }
}

function parseLinkedProductCandidates(text) {
  const candidates = [];
  const lines = String(text || "").split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const matches = [...lines[i].matchAll(new RegExp(PRODUCT_URL_RE.source, "gi"))];
    if (!matches.length) continue;

    for (const urlMatch of matches) {
      const beforeUrl = lines[i].slice(0, urlMatch.index || 0);
      const previous = lines[i - 1] || "";
      const sameLineBoldNames = [...beforeUrl.matchAll(/\*\*([^*]+)\*\*/g)];
      const previousBoldName = previous.match(/\*\*([^*]+)\*\*/);
      const sameLineName =
        sameLineBoldNames.length > 0
          ? sameLineBoldNames[sameLineBoldNames.length - 1][1]
          : beforeUrl;
      const name = (sameLineName || previousBoldName?.[1] || previous)
        .replace(/^\s*\d+\.\s*/, "")
        .replace(/^.*?\b(?:here(?:'s| is)?|this is|link for|the link for)\s+/i, "")
        .replace(/^(here(?:'s| is)?|this is|link for|the link for)\s+/i, "")
        .replace(/^the\s+/i, "")
        .replace(/\s+link\s*:?\s*$/i, "")
        .replace(/\s+[—-]\s*$/u, "")
        .replace(/\s+[—-]\s+.*$/u, "")
        .replace(/^[\s:*_-]+|[\s:*_-]+$/g, "")
        .trim();

      if (name) {
        candidates.push({ name, url: urlMatch[0], lineIndex: i });
      }
    }
  }

  return candidates.slice(0, 5);
}

async function inferProductToolResultFromReply(reply) {
  const candidates = parseLinkedProductCandidates(reply);
  if (!candidates.length) return null;

  const products = [];
  for (const candidate of candidates) {
    try {
      const result = await productSearchApi.searchProducts(candidate.name);
      const shaped = (result.products || [])
        .slice(0, productSearchApi.RESULT_LIMIT || 5)
        .map(productSearchApi.shapeProduct);
      const match =
        shaped.find((p) => normalizeProductKey(p.name) === normalizeProductKey(candidate.name)) ||
        shaped.find((p) => {
          const productName = normalizeProductKey(p.name);
          const candidateName = normalizeProductKey(candidate.name);
          return productName && (productName.includes(candidateName) || candidateName.includes(productName));
        }) ||
        shaped[0] ||
        shaped.find((p) => p.url === candidate.url);

      products.push(
        match
          ? { ...match, requestedName: candidate.name, originalUrl: candidate.url }
          : { name: candidate.name, url: candidate.url, requestedName: candidate.name, originalUrl: candidate.url }
      );
    } catch (err) {
      console.error("[TextChannelTool] Product inference error:", err.message);
      products.push({ name: candidate.name, url: candidate.url, requestedName: candidate.name, originalUrl: candidate.url });
    }
  }

  return products.length ? { found: true, products } : null;
}

function looksLikeProductFollowUp(text) {
  return PRODUCT_FOLLOWUP_RE.test(String(text || ""));
}

// "Are they pointing back at products we already showed them?" — which only justifies
// re-deriving products from history (and overriding the model) when they really are.
//
// This used to match bare "that", "this", "it", "one", "get" and "send", which occur in
// almost any English sentence. A customer asking "Can I get 10% discount code for my
// order please?" matched on "get", so the agent's correct answer about discount codes
// was thrown away and replaced with a list of roller covers (real case, 2026-06-29).
// Referential phrases only — never lone pronouns or verbs.
// The verb forms must stay bound to a pronoun/determiner that points back at something
// we showed ("send it", "can you get it", "send me that"). Bare "get"/"send" is what
// caused the discount-code turn to be answered with roller covers, but dropping them
// outright lost these real follow-ups — so the verb only counts with its object.
const REFERENTIAL_FOLLOWUP_RE =
  /\b(what about|which one|that one|this one|same one|other one|one too|those|these|same|other|asked|links?|urls?|grab|(?:first|second|third|last|black|white|red|blue|green|yellow|clear) one|(?:send|get|grab|share|resend)\s+(?:me\s+|us\s+)?(?:it|that|this|those|these|them|again)\b)/i;

function looksLikeReferentialProductFollowUp(text) {
  return REFERENTIAL_FOLLOWUP_RE.test(String(text || ""));
}

function fallbackNonProductTextReply(text) {
  if (/\b(hi|hello|hey|are you there|anyone there|help)\b/i.test(String(text || ""))) {
    return "Yes, I'm here. How can I help today?";
  }
  return "";
}

function productIntentFromCustomerText(text) {
  return looksLikeDirectProductRequest(text) || looksLikeProductFollowUp(text);
}

function recentHistoryHasOrderIntent(conversationHistory = []) {
  return (conversationHistory || [])
    .slice(-8)
    .some((entry) => entry.role === "customer" && looksLikeOrderIntent(entry.text || ""));
}

/**
 * Phase 0 telemetry for the brain-architecture plan.
 *
 * The question this exists to answer: how often does the model ACTUALLY fail, versus how
 * often do we override a perfectly good answer? Every regex in this file was added to
 * compensate for an assumed model failure, and none of it was ever measured — so we have
 * been deleting and re-adding heuristics on vibes. Two live bugs (a discount-code question
 * answered with roller covers; "my sprayer won't prime" answered with window cleaner) were
 * the compensation misfiring, not the model.
 *
 * Emitted once per text turn as a single structured line. Grep Vercel logs for
 * `[turn-telemetry]` and aggregate.
 *
 * PRIVACY: booleans, counts and lengths only — never message content. These logs are
 * retained by Vercel and must not become a second copy of customer conversations.
 */
function emitTurnTelemetry(fields) {
  try {
    console.log(`[turn-telemetry] ${JSON.stringify(fields)}`);
  } catch {
    /* telemetry must never break a customer reply */
  }
}

/** Which of our hand-written detectors fired for this message. */
function regexSnapshot(text, conversationHistory) {
  const t = String(text || "");
  return {
    orderIntent: looksLikeOrderIntent(t),
    explicitOrderRef: hasExplicitOrderReference(t),
    askedForOrderDetails: agentAskedForOrderDetails(conversationHistory),
    handoffIntent: looksLikeHumanHandoffIntent(t),
    productIntent: productIntentFromCustomerText(t),
    referentialFollowUp: looksLikeReferentialProductFollowUp(t),
  };
}

async function deterministicTextOrderReply({
  text,
  channel,
  customerPhone,
  customerEmail,
  customerId,
  customerOrders,
  conversationHistory,
}) {
  if (channel !== "sms" && channel !== "whatsapp") return "";

  const orderNumber = extractOrderNumber(text);
  const email = extractEmail(text) || customerEmail || "";
  // A bare number is NOT enough on its own — product model numbers (Graco 650, GH 200)
  // would otherwise be looked up as order numbers. It only counts when the customer
  // marked it with "#", or when we just asked them for an order number.
  const isOrderTurn =
    looksLikeOrderIntent(text) ||
    hasExplicitOrderReference(text) ||
    (extractEmail(text) && recentHistoryHasOrderIntent(conversationHistory)) ||
    (Boolean(orderNumber) && agentAskedForOrderDetails(conversationHistory));

  if (!isOrderTurn) return "";

  try {
    const result = await lookupCustomerOrder({
      orderNumber,
      email,
      customerId,
      customerEmail,
      customerPhone,
      recentOrders: customerOrders,
    });
    // This path serves SMS/WhatsApp (text channels), where the customer can't see
    // an on-screen order card — so append the clickable links to the reply. (The
    // base `message` is deliberately URL-free so voice/widget never speaks a URL.)
    let reply = result.message || "";
    if (result.found) {
      if (result.order_link) reply += `\n\nView your order: ${result.order_link}`;
      if (result.tracking_link) reply += `\nTrack it: ${result.tracking_link}`;
    }
    return compactReply(reply);
  } catch (err) {
    console.error("[TextChannelOrder] Lookup error:", err.message);
    // This turn is already known to be order-related (isOrderTurn), so falling through
    // to the full LLM/tool-use path here would just retry the same Shopify call under
    // heavier time pressure and risk hitting the outer timeout with a generic, unhelpful
    // fallback. Answer honestly and fast instead of returning "" and hoping the slow path
    // does better.
    return compactReply(
      "Sorry, I'm having trouble pulling up order details right now. Please try again in a minute, or call 02 5838 5959 for immediate help."
    );
  }
}

function requestedColor(text) {
  const match = String(text || "").match(/\b(black|white|red|blue|green|yellow|clear)\b/i);
  return match ? match[1].toLowerCase() : "";
}

function filterFollowUpProducts(products, text) {
  const color = requestedColor(text);
  if (!color) return products;

  const colorMatches = products.filter((product) => {
    const productText = normalizeProductKey(`${product.name || ""} ${product.url || ""}`);
    return productText.includes(color);
  });

  return colorMatches.length ? colorMatches : products;
}

async function inferProductToolResultFromFollowUp(text, conversationHistory = []) {
  if (!looksLikeProductFollowUp(text)) return null;

  const recentText = (conversationHistory || [])
    .slice(-8)
    .map((entry) => entry.text || "")
    .join("\n");
  const candidates = parseLinkedProductCandidates(recentText).slice(-3);
  const queries = [];
  const currentTokens = directSearchTokens(text);

  for (const entry of (conversationHistory || []).slice(-8).reverse()) {
    if (entry.role !== "customer") continue;
    for (const candidate of extractProductQueryCandidates(entry.text || "").reverse()) {
      const candidateTokens = directSearchTokens(candidate.query);
      const overlapsCurrent =
        currentTokens.length === 0 ||
        currentTokens.some((token) =>
          candidateTokens.some((candidateToken) => tokenMatchesName(token, candidateToken))
        ) ||
        (/brush(?:es)?|cutter|oval/i.test(text) && /brush(?:es)?|cutter|oval/i.test(candidate.query));
      if (overlapsCurrent) queries.push(candidate.query);
    }
    if (queries.length) break;
  }

  for (const candidate of candidates) {
    queries.push(`${candidate.name} ${text}`);
  }

  if (!queries.length) {
    const recentProductishLine = recentText
      .split(/\r?\n/)
      .reverse()
      .find((line) => /dan|graco|rust|oleum|sprayer|paint|kit|coating|sander|primer|tape|brush|cutter|oval/i.test(line));
    if (recentProductishLine) queries.push(`${recentProductishLine} ${text}`);
  }

  for (const query of [...new Set(queries.map((q) => compactProductQuery(q)).filter(Boolean))]) {
    try {
      const result = await productSearchApi.searchProducts(query);
      const products = filterFollowUpProducts(
        (result.products || []).map(productSearchApi.shapeProduct),
        text
      )
        .slice(0, productSearchApi.RESULT_LIMIT || 5)
        .slice(0, requestedColor(text) ? 1 : productSearchApi.RESULT_LIMIT || 5);
      if (products.length) return { found: true, products };
    } catch (err) {
      console.error("[TextChannelTool] Follow-up product inference error:", err.message);
    }
  }

  return null;
}

function mentionsUnavailable(text) {
  return /\b(unavailable|out of stock|not available|not showing in stock|sold out)\b/i.test(
    String(text || "")
  );
}

function applyProductAvailabilityGuard(text, productToolResult) {
  const stockNote = productAvailabilityNote(productToolResult);
  if (!stockNote) return text;

  let guarded = String(text || "");
  const products = Array.isArray(productToolResult?.products) ? productToolResult.products : [];
  const allUnavailable = products.length > 0 && products.every((p) => p.available === false);

  if (allUnavailable) {
    guarded = guarded
      .replace(/\bAll (?:of )?these are available for order\.?/gi, stockNote)
      .replace(/\bAll (?:of )?these are in stock\.?/gi, stockNote)
      .replace(/\bThese are available for order\.?/gi, stockNote)
      .replace(/\bThese are in stock\.?/gi, stockNote)
      .replace(/\bAll (?:of )?these are ready to go\.?/gi, stockNote)
      .replace(/\bAll available for order[^.!?]*[.!?]?/gi, stockNote)
      .replace(/\bAvailable for order[^.!?]*[.!?]?/gi, stockNote)
      .replace(/\bAll available now[^.!?]*[.!?]?/gi, stockNote)
      .replace(/\bAll (?:of )?these (?:products|items|kits)? ?are available[^.!?]*[.!?]?/gi, stockNote);
  }

  if (!mentionsUnavailable(guarded)) {
    guarded = `${guarded}\n\n${stockNote}`;
  }

  return guarded;
}

function findMatchingProduct(candidate, products) {
  const candidateName = normalizeProductKey(candidate?.name);
  if (!candidateName) return null;
  const meaningfulTokens = candidateName
    .split(/\s+/)
    .filter((token) => token.length > 1 && !["the", "in", "for", "link", "here", "is"].includes(token));

  return (
    products.find((p) => normalizeProductKey(p.requestedName) === candidateName) ||
    products.find((p) => p.originalUrl && candidate?.url && p.originalUrl === candidate.url) ||
    products.find((p) => normalizeProductKey(p.name) === candidateName) ||
    products.find((p) => {
      const productName = normalizeProductKey(p.name);
      return productName && (productName.includes(candidateName) || candidateName.includes(productName));
    }) ||
    products.find((p) => {
      const productName = normalizeProductKey(p.name);
      return (
        productName &&
        meaningfulTokens.length >= 2 &&
        meaningfulTokens.every((token) => productName.includes(token))
      );
    }) ||
    null
  );
}

function applyProductUrlGuard(text, productToolResult) {
  const products = Array.isArray(productToolResult?.products) ? productToolResult.products : [];
  if (!products.length) return text;

  const lines = String(text || "").split(/\r?\n/);
  for (const candidate of parseLinkedProductCandidates(text)) {
    const match = findMatchingProduct(candidate, products);
    if (
      match?.url &&
      candidate.url &&
      match.url !== candidate.url &&
      Number.isInteger(candidate.lineIndex) &&
      lines[candidate.lineIndex]
    ) {
      lines[candidate.lineIndex] = lines[candidate.lineIndex].replace(candidate.url, match.url);
    }
  }

  return lines.join("\n");
}

function formatTextChannelReply(reply, productToolResult, channel) {
  let text = normalizeTextMessageLinks(reply);
  const isTextChannel = channel === "sms" || channel === "whatsapp";
  if (!isTextChannel || !productToolResult) return compactReply(text);

  const productSummary = formatProductSummaryFromToolResult(productToolResult);
  if (!productSummary) return compactReply(text);

  if (allProductsUnavailable(productToolResult)) {
    return productSummary;
  }

  if (!text || looksLikeToolPreface(text) || mentionsWebsiteProductUi(text)) {
    return productSummary;
  }

  if (!PRODUCT_URL_RE.test(text)) {
    return compactReply(`${text}\n\n${productSummary}`);
  }

  text = applyProductUrlGuard(text, productToolResult);

  const guarded = applyProductAvailabilityGuard(text, productToolResult);
  if (guarded !== text) {
    return compactReply(guarded);
  }

  return compactReply(text);
}

function collectProductToolResults(value, results = [], seen = new WeakSet()) {
  if (value == null) return results;

  if (typeof value === "string") {
    if (!value.includes("products")) return results;
    try {
      const parsed = JSON.parse(value);
      collectProductToolResults(parsed, results, seen);
    } catch {}
    return results;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectProductToolResults(item, results, seen);
    return results;
  }

  if (typeof value !== "object") return results;
  if (seen.has(value)) return results;
  seen.add(value);

  if (
    Array.isArray(value.products) &&
    (value.found === true || value.products.length > 0)
  ) {
    results.push(value);
  }

  for (const key of Object.keys(value)) {
    collectProductToolResults(value[key], results, seen);
  }

  return results;
}

function formatConversationHistory(history) {
  const entries = Array.isArray(history) ? history : [];
  const lines = entries
    .slice(-12)
    .map((entry) => {
      const role = entry.role === "agent" ? "Jessica" : "Customer";
      const channelLabel = entry.channel ? ` via ${entry.channel}` : "";
      const text = String(entry.text || "").replace(/\s+/g, " ").trim();
      if (!text) return "";
      return `${role}${channelLabel}: ${text.slice(0, 500)}`;
    })
    .filter(Boolean);

  return lines.join("\n").slice(-5000);
}

function channelContext({
  channel,
  customerPhone,
  conversationHistory,
  customerContextSummary,
}) {
  const upperChannel = String(channel || "sms").toUpperCase();
  const historyText = formatConversationHistory(conversationHistory);
  const lines = [
    `Inbound ${upperChannel} from ${customerPhone || "unknown phone"}.`,
    "Reply naturally as Jessica from Paint Access. Keep it concise and suitable for a text message.",
    `Current channel is ${upperChannel}. Reply only in this same ${upperChannel} channel.`,
    "Do not call send_sms_notification from SMS or WhatsApp. If the customer asks for links here, include the links directly in this reply.",
  ];

  if (channel === "sms" || channel === "whatsapp") {
    lines.push(
      "This is a direct text-message channel, not the website widget.",
      "Do not mention product cards, popups, or anything being on the customer's screen.",
      "When recommending products, use search_products and include the full raw paintaccess.com.au product URLs directly in the message."
    );
  }

  if (customerContextSummary) {
    lines.push(
      "Known Shopify customer context for this phone number:",
      String(customerContextSummary).slice(0, 1600),
      "If this phone number matched a Shopify customer, that phone match is enough to discuss that customer's own recent order status and tracking in SMS/WhatsApp. In website_widget, a logged-in Shopify customer_id is enough to discuss that customer's own safe order status. Never reveal address, payment, internal notes, tags, or unrelated account details."
    );
  }

  if (historyText) {
    lines.push(
      "Recent conversation with this same phone number:",
      historyText,
      "Continue from that context. Do not ask the customer to repeat details they already gave unless needed for privacy or confirmation."
    );
  }

  return lines.join("\n");
}

async function askElevenLabsTextAgent({
  text,
  channel = "sms",
  customerPhone = "",
  customerName = "",
  customerEmail = "",
  customerContextSummary = "",
  customerId = "",
  customerTags = "",
  customerRecentOrders = "",
  customerOrders = [],
  conversationHistory = [],
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  const apiKey = cleanEnv("ELEVENLABS_API_KEY");
  const agentId = cleanEnv("ELEVENLABS_AGENT_ID");

  if (!apiKey || !agentId) {
    throw new Error("Missing ELEVENLABS_API_KEY or ELEVENLABS_AGENT_ID");
  }

  // Phase 0: capture what our detectors decided BEFORE any of them act, so a bypass is
  // visible in the data rather than silently skipping the model.
  const startedAt = Date.now();
  const rx = regexSnapshot(text, conversationHistory);
  const telBase = { channel, textChars: String(text || "").length, rx };

  const orderReply = await deterministicTextOrderReply({
    text,
    channel,
    customerPhone,
    customerEmail,
    customerId,
    customerOrders,
    conversationHistory,
  });
  if (orderReply) {
    // The model was never consulted on this turn — a regex answered for it.
    emitTurnTelemetry({
      ...telBase,
      ms: Date.now() - startedAt,
      outcome: "bypass_order",
      modelConsulted: false,
      replyChars: orderReply.length,
    });
    return orderReply;
  }

  // Escalation is too important to leave to the model — see the note on
  // deterministicHumanHandoffReply. Runs before the LLM/WebSocket entirely.
  const handoffReply = await deterministicHumanHandoffReply({
    text,
    channel,
    customerPhone,
    customerName,
    customerEmail,
  });
  if (handoffReply) {
    emitTurnTelemetry({
      ...telBase,
      ms: Date.now() - startedAt,
      outcome: "bypass_handoff",
      modelConsulted: false,
      replyChars: handoffReply.length,
    });
    return handoffReply;
  }

  const signedUrl = await getSignedUrl(agentId, apiKey);
  const WebSocketCtor = getWebSocketCtor();

  return new Promise((resolve, reject) => {
    const ws = new WebSocketCtor(signedUrl);
    const turnStartedAt = Date.now();
    let responseIndex = 0;
    let currentResponse = "";
    let latestReply = "";
    let lastReplyWasToolPreface = false;
    let latestProductToolResult = null;
    let latestHandoffToolResult = null;
    let settleTimer = null;
    let settled = false;

    // Phase 0 telemetry — see emitTurnTelemetry(). Counts what the MODEL did versus what
    // WE decided, so the question "how often does the model actually fail vs how often do
    // we override it needlessly" stops being a matter of opinion.
    const tel = {
      clientToolCalls: 0,
      webhookToolResponses: 0,
      toolNames: [],
      responseParts: 0,
      agentResponses: 0,
      interruptions: 0,
    };

    const timeout = setTimeout(() => {
      // A completed handoff outranks a timeout: staff have already been paged, so
      // the customer MUST get the link rather than a generic fallback.
      if (latestHandoffToolResult) {
        finish(null, latestHandoffToolResult.message);
        return;
      }
      if (latestProductToolResult) {
        finish(null, formatProductSummaryFromToolResult(latestProductToolResult));
        return;
      }
      if (latestReply) {
        finish(null, latestReply);
        return;
      }
      finish(new Error("ElevenLabs text response timed out"));
    }, timeoutMs);

    async function finish(err, reply) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(settleTimer);
      try {
        ws.close();
      } catch {}

      // Never drop a handoff on the floor — even a socket error/timeout must still
      // deliver the link, because escalate_to_human already ran server-side.
      if (err && latestHandoffToolResult) {
        err = null;
        reply = latestHandoffToolResult.message;
      }

      if (err) {
        // Emit on the failure paths too. A telemetry set that only records successes would
        // make the model look more reliable than it is — exactly the bias this is meant to
        // remove.
        emitTurnTelemetry({
          ...telBase,
          ms: Date.now() - startedAt,
          outcome: /timed out/i.test(err.message || "") ? "timeout" : "error",
          modelConsulted: true,
          model: {
            responseParts: tel.responseParts,
            agentResponses: tel.agentResponses,
            clientToolCalls: tel.clientToolCalls,
            webhookToolResponses: tel.webhookToolResponses,
            tools: tel.toolNames,
            replyChars: String(latestReply || "").length,
          },
          err: String(err.message || "").slice(0, 80),
        });
        reject(err);
      } else {
        // Handoff takes precedence over all product formatting below.
        if (latestHandoffToolResult) {
          const handoffMsg = String(latestHandoffToolResult.message || "");
          const said = compactReply(reply);
          if (/wa\.me\//i.test(said)) resolve(said);
          else if (!said || looksLikeToolPreface(said)) resolve(compactReply(handoffMsg));
          else resolve(compactReply(`${said}\n\n${handoffMsg}`));
          return;
        }
        // productResult starts as the model's OWN search_products call. That is its
        // judgment about whether this turn is about products, and it is the only
        // product data we should treat as authoritative.
        let productResult = latestProductToolResult;
        let cleanReply = compactReply(reply);
        const isTextChannel = channel === "sms" || channel === "whatsapp";
        const textChannelProductIntent =
          isTextChannel && productIntentFromCustomerText(text);

        if (isTextChannel && !textChannelProductIntent) {
          productResult = null;
          if (PRODUCT_URL_RE.test(String(reply || "")) || mentionsWebsiteProductUi(reply)) {
            reply = fallbackNonProductTextReply(text);
            cleanReply = compactReply(reply);
          }
        }

        // The model promised to go and look ("let me search that", "I'll grab the link")
        // but no search_products result came back — an unkept promise, so it has not
        // answered no matter how much text surrounds it. This is the compound-request case:
        // "Dan's sprayers AND an oval cutter brush" often gets a chatty half-answer that
        // ends "...for the brush, let me search what we've got", with no tool call and no
        // links. The length gate on looksLikeToolPreface deliberately lets long replies
        // through, so it cannot catch this on its own.
        // Only genuine promises of a future action — "let me search", "I'll grab that".
        // NOT the present continuous: "I'm looking at the Graco 495 specs" is the model
        // describing what it is telling you, not undertaking to go and look, and treating
        // it as an unkept promise would re-open the very product-injection hole this
        // function exists to close.
        const promisedToLook =
          /\b(let me|i'?ll|i will)\s+(?:go |quickly |now |just )?(search|check|look|find|grab|pull)\w*/i.test(
            cleanReply
          );
        const brokePromise = promisedToLook && !latestProductToolResult;

        // Did the model actually answer? On a text channel, "let me go check that" or
        // "it's on your screen" is not an answer — those are the cases where we legitimately
        // have to speak for it.
        const modelAnswered =
          Boolean(cleanReply) &&
          !looksLikeToolPreface(cleanReply) &&
          !mentionsWebsiteProductUi(cleanReply) &&
          !brokePromise;

        // Regex-inferred products are a RECOVERY path, never an override.
        //
        // Reaching for them when the model HAS answered is how "My sprayer runs but won't
        // prime" got answered with 30 Seconds Window Cleaner: the word "sprayer" matched a
        // product keyword, so we ran our own search and pasted its results over a correct
        // troubleshooting answer. The whole 30k troubleshooting guide could never reach an
        // SMS customer, however well indexed, because this ran on every turn containing a
        // product word.
        //
        // The model decides whether products are relevant. We only step in when it gave us
        // nothing usable to send.
        if (isTextChannel && textChannelProductIntent && !modelAnswered) {
          const preferFollowUp = looksLikeReferentialProductFollowUp(text);
          const directProductResult = preferFollowUp
            ? null
            : await inferProductToolResultFromDirectRequest(text);
          // Searching the HISTORY is only legitimate when they're referring back to
          // something we already showed.
          const followUpProductResult = preferFollowUp
            ? await inferProductToolResultFromFollowUp(text, conversationHistory)
            : null;

          const inferred = followUpProductResult?.products?.length
            ? followUpProductResult
            : directProductResult?.products?.length
              ? directProductResult
              : null;
          if (inferred) productResult = inferred;
        }
        // Last-ditch: the model said nothing at all and we have no products yet. These used
        // to resolve() early, which skipped telemetry on exactly the turns worth measuring
        // (the model produced nothing and a regex spoke for it). Assign and fall through to
        // the single exit below — formatTextChannelReply already substitutes the summary
        // when the reply is empty, so behaviour is unchanged.
        if (!cleanReply && isTextChannel && !productResult?.products?.length) {
          const fallbackProductResult = await inferProductToolResultFromFollowUp(
            text,
            conversationHistory
          );
          if (fallbackProductResult?.products?.length) productResult = fallbackProductResult;
        }
        // The model put links in its reply — resolve them against real product data so
        // applyProductUrlGuard below can correct any it invented. This VALIDATES the
        // model's output; it does not replace it.
        if (
          isTextChannel &&
          textChannelProductIntent &&
          PRODUCT_URL_RE.test(String(reply || ""))
        ) {
          const inferredProductResult = await inferProductToolResultFromReply(reply);
          if (inferredProductResult?.products?.length) {
            productResult = inferredProductResult;
          }
        }

        const finalText = formatTextChannelReply(reply, productResult, channel);
        emitTurnTelemetry({
          ...telBase,
          ms: Date.now() - startedAt,
          outcome: "replied",
          modelConsulted: true,
          // What the MODEL did.
          model: {
            responseParts: tel.responseParts,
            agentResponses: tel.agentResponses,
            clientToolCalls: tel.clientToolCalls,
            webhookToolResponses: tel.webhookToolResponses,
            tools: tel.toolNames,
            interruptions: tel.interruptions,
            replyChars: cleanReply.length,
            answered: modelAnswered,
            brokePromise,
          },
          // What WE did to it. usedInferredProducts=true means a regex, not the model,
          // decided which products the customer sees.
          us: {
            hadOwnToolResult: Boolean(latestProductToolResult),
            usedInferredProducts: Boolean(productResult) && productResult !== latestProductToolResult,
            replacedReply: Boolean(cleanReply) && finalText !== compactReply(reply),
            finalChars: String(finalText || "").length,
          },
        });
        // formatTextChannelReply is handed the model's REAL reply above: it decides on the
        // evidence (empty / tool preface / on-screen reference) whether that reply is
        // unusable and a product summary should stand in — rather than a regex deciding up
        // front that the model's answer should be thrown away.
        resolve(finalText);
      }
    }

    function sendCustomerMessage() {
      sendJson(ws, {
        type: "contextual_update",
        text: channelContext({
          channel,
          customerPhone,
          conversationHistory,
          customerContextSummary,
        }),
      });
      sendJson(ws, { type: "user_message", text });
    }

    function scheduleFinish(reply) {
      clearTimeout(settleTimer);

      const waitMs = looksLikeToolPreface(reply)
        ? TOOL_REPLY_SETTLE_MS
        : NORMAL_REPLY_SETTLE_MS;

      settleTimer = setTimeout(() => {
        if (latestHandoffToolResult) {
          finish(null, latestHandoffToolResult.message);
          return;
        }
        if (lastReplyWasToolPreface && latestProductToolResult) {
          finish(null, formatProductSummaryFromToolResult(latestProductToolResult));
          return;
        }
        finish(null, latestReply);
      }, waitMs);
    }

    ws.onopen = () => {
      sendJson(ws, {
        type: "conversation_initiation_client_data",
        conversation_config_override: {
          conversation: { text_only: true },
          // Only override the model when TEXT_CHANNEL_LLM is set; otherwise send nothing
          // and let the agent's own (voice-tuned) default stand.
          ...(TEXT_CHANNEL_LLM
            ? { agent: { prompt: { llm: TEXT_CHANNEL_LLM } } }
            : {}),
        },
        dynamic_variables: {
          customer_name: customerName,
          customer_email: customerEmail,
          customer_phone: customerPhone,
          customer_id: customerId,
          customer_tags: customerTags,
          customer_recent_orders: customerRecentOrders,
          customer_context_summary: customerContextSummary,
          channel,
        },
      });
    };

    ws.onmessage = async (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }

      if (data.type === "ping") {
        sendJson(ws, {
          type: "pong",
          event_id: data.ping_event?.event_id,
        });
        return;
      }

      // ── telemetry: what the MODEL did this turn ──────────────────────────────
      if (data.type === "agent_tool_response") {
        tel.webhookToolResponses += 1;
        const n = data.agent_tool_response?.tool_name;
        if (n && !tel.toolNames.includes(n)) tel.toolNames.push(n);
      } else if (data.type === "agent_chat_response_part") {
        tel.responseParts += 1;
      } else if (data.type === "agent_response") {
        tel.agentResponses += 1;
      } else if (data.type === "interruption") {
        tel.interruptions += 1;
      }

      if (data.type === "client_tool_call") {
        const call = data.client_tool_call || {};
        tel.clientToolCalls += 1;
        if (call.tool_name && !tel.toolNames.includes(call.tool_name)) tel.toolNames.push(call.tool_name);
        let result;
        try {
          result = await runTextChannelTool(call);
        } catch (err) {
          console.error("[TextChannelTool] Error:", call.tool_name, err.message);
          result = {
            found: false,
            error: "Tool failed. Ask the customer to call Paint Access or try a broader product name.",
          };
        }

        const productResults = collectProductToolResults(result);
        if (productResults.length) {
          latestProductToolResult = productResults[productResults.length - 1];
        }
        sendJson(ws, {
          type: "client_tool_result",
          tool_call_id: call.tool_call_id,
          result: typeof result === "string" ? result : JSON.stringify(result),
          is_error: Boolean(result && typeof result === "object" && result.error),
        });
        return;
      }

      const productResults = collectProductToolResults(data);
      if (productResults.length) {
        latestProductToolResult = productResults[productResults.length - 1];
      }

      const handoffResults = collectHandoffToolResults(data);
      if (handoffResults.length) {
        latestHandoffToolResult = handoffResults[handoffResults.length - 1];
      }

      if (data.type !== "agent_chat_response_part") return;

      const part = data.text_response_part || {};
      if (part.type === "start") {
        currentResponse = "";
      } else if (part.type === "delta") {
        currentResponse += part.text || "";
      } else if (part.type === "stop") {
        responseIndex += 1;

        // The agent sends its configured first_message immediately after
        // connection. Ignore that greeting and use the next response, which is
        // generated from the actual inbound SMS/WhatsApp message.
        if (responseIndex === 1) {
          sendCustomerMessage();
          return;
        }

        latestReply = currentResponse;
        lastReplyWasToolPreface = looksLikeToolPreface(currentResponse);
        scheduleFinish(currentResponse);
      }
    };

    ws.onerror = () => finish(new Error("ElevenLabs WebSocket error"));
    ws.onclose = (event) => {
      if (!settled && event.code !== 1000) {
        finish(new Error(`ElevenLabs WebSocket closed: ${event.code} ${event.reason || ""}`.trim()));
      }
    };
  });
}

module.exports = {
  askElevenLabsTextAgent,
  // exported for tests
  looksLikeHumanHandoffIntent,
  looksLikeReferentialProductFollowUp,
};
