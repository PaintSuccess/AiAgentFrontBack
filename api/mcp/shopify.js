const { cleanEnv } = require("../../lib/shopify");
const {
  CONTROLLED_TAGS,
  OPS_METAFIELD_KEYS,
  addOrderNote,
  addOrderTag,
  getFulfillmentReadiness,
  getOrder,
  prepareCancellation,
  prepareFulfillment,
  removeOrderTag,
  searchOrders,
  setOpsMetafield,
} = require("../../lib/shopify-ops");

const MCP_PROTOCOL_VERSION = "2025-03-26";

const SERVER_INSTRUCTIONS =
  "PaintAccess Shopify Operations MCP exposes narrow Shopify operations for ChatGPT Workspace Agents. Use read tools first, write only to known orders, never claim Gmail/Drive actions here, and treat cancellation, refund, payment, email send, and final fulfilment as approval-required.";

const TOOL_HANDLERS = {
  shopify_search_orders: searchOrders,
  shopify_get_order: getOrder,
  shopify_get_fulfillment_readiness: getFulfillmentReadiness,
  shopify_add_order_note: addOrderNote,
  shopify_add_order_tag: addOrderTag,
  shopify_remove_order_tag: removeOrderTag,
  shopify_set_ops_metafield: setOpsMetafield,
  shopify_prepare_fulfillment: prepareFulfillment,
  shopify_prepare_cancellation: prepareCancellation,
};

const tools = [
  {
    name: "shopify_search_orders",
    title: "Search Shopify orders",
    description:
      "Find PaintAccess Shopify orders by order number, customer, date range, status, tag, or free-text query. Read-only.",
    inputSchema: objectSchema({
      query: stringProp("Optional Shopify admin search text."),
      order_number: stringProp("Order number such as #44478."),
      customer_email: stringProp("Customer email address."),
      customer_name: stringProp("Customer name or company."),
      created_at_min: stringProp("Minimum created date in ISO format."),
      created_at_max: stringProp("Maximum created date in ISO format."),
      financial_status: stringProp("Financial status filter, for example paid."),
      fulfillment_status: stringProp("Fulfilment status filter, for example unfulfilled."),
      tag: stringProp("Shopify order tag filter."),
      limit: numberProp("Maximum orders to return, 1-25."),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: "shopify_get_order",
    title: "Get Shopify order",
    description:
      "Get staff operational details for one PaintAccess Shopify order. Use this before any write. Read-only.",
    inputSchema: orderIdentifierSchema(),
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: "shopify_get_fulfillment_readiness",
    title: "Get fulfilment readiness",
    description:
      "Inspect fulfilment orders and readiness for a PaintAccess Shopify order without completing fulfilment. Read-only.",
    inputSchema: orderIdentifierSchema(),
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: "shopify_add_order_note",
    title: "Add Shopify order note",
    description:
      "Append a controlled PaintAccess Operations Desk note to a known Shopify order. Does not cancel, refund, send email, or complete fulfilment.",
    inputSchema: objectSchema(
      {
        ...orderIdentifierProps(),
        note_type: stringProp("Controlled note type, e.g. po_drafted, tracking_received, manual_action_required."),
        summary: stringProp("Concise operational summary to record."),
        source: stringProp("Source of action, e.g. ChatGPT Operations Desk, Gmail app, Daniel approval."),
        supplier: stringProp("Supplier name when relevant."),
        next_action: stringProp("Next operational action."),
        copy_text: stringProp("Optional short copy of email/PO/details."),
        approval_reference: stringProp("Approval reference if the note records an approved action."),
      },
      ["summary"]
    ),
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "shopify_add_order_tag",
    title: "Add Shopify process tag",
    description:
      "Add a controlled Operations Desk process tag to a known Shopify order. Blocks duplicate PO sent markers unless explicitly overridden after approval.",
    inputSchema: objectSchema(
      {
        ...orderIdentifierProps(),
        tag: enumProp("Controlled Operations Desk tag.", CONTROLLED_TAGS),
        supplier: stringProp("Supplier name, used for PO sent - Supplier tags."),
        reason: stringProp("Reason for adding the tag."),
        override_duplicate: booleanProp("Only true after Daniel approves a duplicate PO marker override."),
      },
      ["tag"]
    ),
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "shopify_remove_order_tag",
    title: "Remove Shopify process tag",
    description:
      "Remove a controlled Operations Desk process tag from a known Shopify order when correcting workflow state.",
    inputSchema: objectSchema(
      {
        ...orderIdentifierProps(),
        tag: enumProp("Controlled Operations Desk tag.", CONTROLLED_TAGS),
        supplier: stringProp("Supplier name when removing a PO sent - Supplier marker."),
        reason: stringProp("Reason for removing the tag."),
      },
      ["tag"]
    ),
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "shopify_set_ops_metafield",
    title: "Set Shopify operations metafield",
    description:
      "Set one controlled paintaccess_ops metafield on a known Shopify order for workflow state. Use only for Operations Desk state, not arbitrary order data.",
    inputSchema: objectSchema(
      {
        ...orderIdentifierProps(),
        key: enumProp("Allowed paintaccess_ops metafield key.", OPS_METAFIELD_KEYS),
        value: stringProp("State value to store, max 255 chars."),
        reason: stringProp("Reason for the state change."),
      },
      ["key", "value"]
    ),
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "shopify_prepare_fulfillment",
    title: "Prepare Shopify fulfilment",
    description:
      "Prepare and validate a fulfilment/tracking preview for a known Shopify order. Does not complete final fulfilment. Daniel approval is required for final fulfilment.",
    inputSchema: objectSchema(
      {
        ...orderIdentifierProps(),
        tracking_number: stringProp("Tracking number to prepare."),
        tracking_company: stringProp("Carrier/company name."),
        tracking_url: stringProp("Tracking URL."),
        notify_customer: booleanProp("Whether the final fulfilment would notify the customer. Preview only."),
      },
      ["tracking_number"]
    ),
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "shopify_prepare_cancellation",
    title: "Prepare cancellation/refund",
    description:
      "Prepare a cancellation/refund readiness report and suggested note. Does not cancel, refund, or delete the order.",
    inputSchema: objectSchema(
      {
        ...orderIdentifierProps(),
        reason: stringProp("Reason for cancellation/refund preparation."),
        customer_request_source: stringProp("Source of request, e.g. customer email, phone, staff note."),
      },
      ["reason"]
    ),
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
];

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    return res.status(200).json({
      name: "PaintAccess Shopify Operations MCP",
      version: "1.0.0",
      endpoint: "/api/mcp/shopify",
      tools: tools.map((tool) => tool.name),
      instructions: SERVER_INSTRUCTIONS,
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!verifyMcpAccess(req)) {
    return res.status(401).json({
      error: "Unauthorized",
      message:
        "Missing or invalid MCP token. Configure SHOPIFY_MCP_TOKEN and add ?token=... to the private connector URL, or implement OAuth before broad rollout.",
    });
  }

  const message = req.body || {};
  if (Array.isArray(message)) {
    const responses = [];
    for (const item of message) {
      const response = await handleJsonRpc(item);
      if (response) responses.push(response);
    }
    return res.status(200).json(responses);
  }

  const response = await handleJsonRpc(message);
  if (!response) return res.status(204).end();
  return res.status(200).json(response);
};

async function handleJsonRpc(message) {
  const id = message?.id;
  const method = message?.method;
  const params = message?.params || {};

  try {
    if (!message || message.jsonrpc !== "2.0" || !method) {
      return jsonRpcError(id || null, -32600, "Invalid JSON-RPC request.");
    }

    if (method === "initialize") {
      return jsonRpcResult(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: {
          name: "paintaccess-shopify-operations",
          title: "PaintAccess Shopify Operations",
          version: "1.0.0",
        },
        instructions: SERVER_INSTRUCTIONS,
      });
    }

    if (method === "notifications/initialized") return null;
    if (method === "ping") return jsonRpcResult(id, {});
    if (method === "tools/list") return jsonRpcResult(id, { tools });
    if (method === "resources/list") return jsonRpcResult(id, { resources: [] });
    if (method === "prompts/list") return jsonRpcResult(id, { prompts: [] });

    if (method === "tools/call") {
      const name = params.name;
      const args = params.arguments || {};
      const fn = TOOL_HANDLERS[name];
      if (!fn) return jsonRpcError(id, -32602, `Unknown tool: ${name}`);
      const result = await fn(args);
      return jsonRpcResult(id, toolResult(result));
    }

    return jsonRpcError(id, -32601, `Method not found: ${method}`);
  } catch (err) {
    const payload = {
      code: err.code || "tool_error",
      message: err.message || "Tool failed.",
      status_code: err.statusCode || 500,
      candidates: err.candidates || undefined,
      graphql_errors: err.graphqlErrors || undefined,
    };
    return jsonRpcResult(id, {
      isError: true,
      content: [{ type: "text", text: payload.message }],
      structuredContent: payload,
    });
  }
}

function toolResult(result) {
  return {
    content: [
      {
        type: "text",
        text: summarizeResult(result),
      },
    ],
    structuredContent: result,
  };
}

function summarizeResult(result) {
  if (result?.orders) return `Found ${result.orders.length} Shopify order(s).`;
  if (result?.order_number && result?.ok === false) {
    return result.message || `Action not completed for ${result.order_number}.`;
  }
  if (result?.order_number && result?.tag) {
    return `${result.ok ? "Updated" : "Checked"} ${result.order_number}: ${result.tag}.`;
  }
  if (result?.order_number && result?.note_added) {
    return `Added Operations Desk note to ${result.order_number}.`;
  }
  if (result?.order_number && result?.approval_required) {
    return `Prepared action for ${result.order_number}. Daniel approval required before final execution.`;
  }
  if (result?.order_number) return `Retrieved ${result.order_number}.`;
  return "Tool completed.";
}

function verifyMcpAccess(req) {
  const expected = cleanEnv("SHOPIFY_MCP_TOKEN");
  const allowUnauthenticated = cleanEnv("SHOPIFY_MCP_ALLOW_UNAUTHENTICATED") === "true";
  if (!expected) return allowUnauthenticated;

  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  const queryToken = getQueryParam(req, "token");
  const provided = bearer || queryToken;
  return Boolean(provided) && safeEqual(provided, expected);
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return require("crypto").timingSafeEqual(left, right);
}

function getQueryParam(req, name) {
  try {
    const url = new URL(req.url || "", `https://${req.headers.host || "localhost"}`);
    return url.searchParams.get(name) || "";
  } catch {
    return "";
  }
}

function jsonRpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept");
}

function stringProp(description) {
  return { type: "string", description };
}

function numberProp(description) {
  return { type: "number", description };
}

function booleanProp(description) {
  return { type: "boolean", description };
}

function enumProp(description, values) {
  return { type: "string", enum: values, description };
}

function orderIdentifierProps() {
  return {
    order_id: stringProp("Shopify order GID, preferred for writes."),
    order_number: stringProp("Shopify order number such as #44478."),
  };
}

function orderIdentifierSchema() {
  return objectSchema(orderIdentifierProps());
}

function objectSchema(properties, required = []) {
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required,
  };
}
