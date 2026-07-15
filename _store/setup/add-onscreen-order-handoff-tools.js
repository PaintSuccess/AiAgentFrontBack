/**
 * One-off (2026-07-15): make orders + human-handoff render ON SCREEN in the
 * website widget (like product cards), instead of the agent reading URLs aloud.
 *
 * Does three idempotent things:
 *   1. Create client tools `display_order_in_chat` + `open_whatsapp_handoff`
 *      (skip if already attached to the agent) and attach them.
 *   2. Append a widget instruction to the `escalate_to_human` tool description.
 *   3. Patch the lookup_order prompt rule (point 4) to require the order card on
 *      the widget and forbid reading URLs aloud.
 *
 * Run once:  node _store/setup/add-onscreen-order-handoff-tools.js
 */
import "dotenv/config";

const API_KEY = process.env.ELEVENLABS_API_KEY;
const AGENT_ID = process.env.ELEVENLABS_AGENT_ID;
const ESCALATE_TOOL_ID = "tool_0501kxhyyx8yfjx9ssx65j71w8cf";
const H = { "xi-api-key": API_KEY, "Content-Type": "application/json" };

const orderTool = {
  type: "client",
  name: "display_order_in_chat",
  description:
    "Website widget / browser voice ONLY. Renders the customer's order as an on-screen card. " +
    "Call this IMMEDIATELY after a successful lookup_order when on the website widget, passing the " +
    "display_order_in_chat_payload object from the lookup_order result. NEVER read the order or tracking " +
    "URL aloud — show them here. After calling, say a one-line summary and that the details are on their screen. " +
    "Do NOT call in SMS or WhatsApp (include the links in the text reply there instead).",
  expects_response: false,
  parameters: {
    type: "object",
    required: ["order_number"],
    properties: {
      order_number: { type: "string", description: "e.g. #44542" },
      date: { type: "string" },
      payment_status: { type: "string" },
      fulfillment_status: { type: "string" },
      total: { type: "string", description: "e.g. '39.00 AUD'" },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: { title: { type: "string" }, quantity: { type: "number" } },
        },
      },
      order_url: { type: "string", description: "Customer order status page link." },
      tracking_url: { type: "string" },
      tracking_company: { type: "string" },
    },
  },
};

const handoffTool = {
  type: "client",
  name: "open_whatsapp_handoff",
  description:
    "Website widget / browser voice ONLY. Shows a 'Chat on WhatsApp' button on the customer's screen (and " +
    "attempts to auto-open it) so they can reach a human. Call this IMMEDIATELY after escalate_to_human when on " +
    "the website widget, passing the open_whatsapp_handoff_payload (its link) from the escalate_to_human result. " +
    "Then tell the customer to tap the button on their screen. NEVER read the link aloud. " +
    "Do NOT call in SMS or WhatsApp (the link is already delivered in the message there).",
  expects_response: false,
  parameters: {
    type: "object",
    required: ["link"],
    properties: {
      link: { type: "string", description: "The wa.me link from the escalate_to_human result." },
      reason: { type: "string" },
    },
  },
};

const OLD_POINT4 =
  "4. Summarize the order status clearly, including tracking links if available. Do not include addresses, payment details, internal notes, tags, or unrelated customer data.";
const NEW_POINT4 =
  "4. Summarize the order status clearly. Do not include addresses, payment details, internal notes, tags, or unrelated customer data. " +
  "ON THE WEBSITE WIDGET (voice or text): after a successful lookup_order you MUST call display_order_in_chat with the display_order_in_chat_payload, and you MUST NOT read the order or tracking URL aloud — give a one-line spoken summary and say the details are on their screen. " +
  "ON SMS OR WHATSAPP: do not call display_order_in_chat; end your text reply with the order link (order_link) and tracking link (tracking_link) when present.";

const ESCALATE_WIDGET_NOTE =
  " ON THE WEBSITE WIDGET (voice or text): immediately after this tool returns, you MUST call open_whatsapp_handoff with the returned link (open_whatsapp_handoff_payload) so the WhatsApp button appears on their screen, then tell them to tap it — do not just say it's on screen without calling that tool.";

async function listTools() {
  const r = await fetch("https://api.elevenlabs.io/v1/convai/tools", { headers: H });
  if (!r.ok) throw new Error(`List tools failed: ${r.status} ${await r.text()}`);
  const d = await r.json();
  return d.tools || d || [];
}

async function ensureClientTool(def, attachedIds) {
  const all = await listTools();
  const existing = all.find((t) => (t.tool_config?.name || t.name) === def.name);
  if (existing && attachedIds.includes(existing.id)) {
    console.log(`  ${def.name}: already attached (${existing.id}).`);
    return existing.id;
  }
  if (existing) {
    console.log(`  ${def.name}: exists (${existing.id}) but not attached — will attach.`);
    return existing.id;
  }
  const r = await fetch("https://api.elevenlabs.io/v1/convai/tools", {
    method: "POST",
    headers: H,
    body: JSON.stringify({ tool_config: def }),
  });
  if (!r.ok) throw new Error(`Create ${def.name} failed: ${r.status} ${await r.text()}`);
  const { id } = await r.json();
  console.log(`  ${def.name}: created (${id}).`);
  return id;
}

async function run() {
  if (!API_KEY || !AGENT_ID) throw new Error("ELEVENLABS_API_KEY / ELEVENLABS_AGENT_ID missing.");

  // --- fetch agent once ---
  const getRes = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${AGENT_ID}`, { headers: H });
  if (!getRes.ok) throw new Error(`Fetch agent failed: ${getRes.status} ${await getRes.text()}`);
  const agent = await getRes.json();
  const attachedIds = agent.conversation_config?.agent?.prompt?.tool_ids ?? [];
  let prompt = agent.conversation_config?.agent?.prompt?.prompt || "";

  // --- 1. client tools ---
  console.log("Ensuring client tools…");
  const orderId = await ensureClientTool(orderTool, attachedIds);
  const handoffId = await ensureClientTool(handoffTool, attachedIds);
  const updatedIds = Array.from(new Set([...attachedIds, orderId, handoffId]));

  // --- 3. prompt point 4 ---
  if (prompt.includes(OLD_POINT4)) {
    prompt = prompt.replace(OLD_POINT4, NEW_POINT4);
    console.log("Prompt point 4 → widget order-card rule queued.");
  } else if (prompt.includes(NEW_POINT4)) {
    console.log("Prompt point 4 already updated.");
  } else {
    console.warn("⚠ Could not find lookup_order point 4 to update — skipping prompt patch.");
  }

  // attach tools + prompt in one PATCH
  const patchRes = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${AGENT_ID}`, {
    method: "PATCH",
    headers: H,
    body: JSON.stringify({
      conversation_config: { agent: { prompt: { tool_ids: updatedIds, prompt } } },
    }),
  });
  if (!patchRes.ok) throw new Error(`Patch agent failed: ${patchRes.status} ${await patchRes.text()}`);
  const result = await patchRes.json();
  const liveIds = result.conversation_config?.agent?.prompt?.tool_ids ?? [];
  console.log(`Agent tools now (${liveIds.length}):`, liveIds.join(", "));

  // --- 2. escalate tool description ---
  const toolRes = await fetch(`https://api.elevenlabs.io/v1/convai/tools/${ESCALATE_TOOL_ID}`, { headers: H });
  if (toolRes.ok) {
    const tool = await toolRes.json();
    const cfg = tool.tool_config || tool;
    if (cfg && typeof cfg.description === "string" && !cfg.description.includes("open_whatsapp_handoff")) {
      cfg.description += ESCALATE_WIDGET_NOTE;
      const pr = await fetch(`https://api.elevenlabs.io/v1/convai/tools/${ESCALATE_TOOL_ID}`, {
        method: "PATCH",
        headers: H,
        body: JSON.stringify({ tool_config: cfg }),
      });
      console.log(pr.ok ? "escalate_to_human description updated." : `⚠ escalate patch failed: ${pr.status}`);
    } else {
      console.log("escalate_to_human description already mentions open_whatsapp_handoff.");
    }
  } else {
    console.warn("⚠ Could not fetch escalate tool to update its description.");
  }

  console.log("\nDone.");
}

run().catch((err) => {
  console.error("\n❌ Error:", err.message);
  process.exit(1);
});
