const { cleanEnv, rateLimit } = require("../../lib/shopify");
const {
  DEFAULT_SCOPES,
  protectedResourceMetadata,
  sendUnauthorized,
  verifyMcpRequest,
} = require("../../lib/mcp-auth");
const {
  driveCreateTextFile,
  driveGetFile,
  driveSearchFiles,
  gmailCreateDraft,
  gmailGetMessage,
  gmailSearchMessages,
  gmailSendEmail,
} = require("../../lib/google-workspace");
const {
  CONTROLLED_TAGS,
  OPS_METAFIELD_KEYS,
  addOrderNote,
  addOrderTimelineEntry,
  addOrderTag,
  completeFulfillment,
  getFulfillmentReadiness,
  getOrder,
  prepareCancellation,
  prepareCustomerEmail,
  prepareFulfillment,
  removeOrderNoteEntry,
  removeOrderTag,
  searchOrders,
  sendCustomerEmailViaShopify,
  setOpsMetafield,
} = require("../../lib/shopify-ops");
const {
  commsSearchThreads,
  commsGetThread,
  commsSendMessage,
  commsTakeOver,
  commsHandBack,
} = require("../../lib/comms/mcp-tools");

const MCP_PROTOCOL_VERSION = "2025-03-26";

const SERVER_INSTRUCTIONS =
  "PaintAccess Operations MCP exposes narrow Shopify, Gmail, Google Drive, and unified customer communications operations for ChatGPT Workspace Agents. Use read tools first, write only to known orders/resources, and treat cancellation, refund, payment, email send, customer SMS/WhatsApp send, and final fulfilment as approval-required. Use comms_search_threads/comms_get_thread to read a customer's full cross-channel history, comms_send_message to reply (approval_reference required), and comms_take_over/comms_hand_back to control whether the AI auto-replies. For operational order logging, use Shopify order timeline entries; do not leave operations logs in the persistent Shopify Notes field.";

const SECURITY_SCHEMES = [{ type: "oauth2", scopes: DEFAULT_SCOPES }];

const TOOL_HANDLERS = {
  shopify_search_orders: searchOrders,
  shopify_get_order: getOrder,
  shopify_get_fulfillment_readiness: getFulfillmentReadiness,
  shopify_record_order_timeline_entry: addOrderTimelineEntry,
  shopify_add_order_note: addOrderNote,
  shopify_remove_order_note_entry: removeOrderNoteEntry,
  shopify_add_order_tag: addOrderTag,
  shopify_remove_order_tag: removeOrderTag,
  shopify_set_ops_metafield: setOpsMetafield,
  shopify_prepare_fulfillment: prepareFulfillment,
  shopify_complete_fulfillment: completeFulfillment,
  shopify_prepare_cancellation: prepareCancellation,
  shopify_prepare_customer_email: prepareCustomerEmail,
  shopify_send_customer_email: sendCustomerEmailViaShopify,
  gmail_search_messages: gmailSearchMessages,
  gmail_get_message: gmailGetMessage,
  gmail_create_draft: gmailCreateDraft,
  gmail_send_email: gmailSendEmail,
  drive_search_files: driveSearchFiles,
  drive_get_file: driveGetFile,
  drive_create_text_file: driveCreateTextFile,
  comms_search_threads: commsSearchThreads,
  comms_get_thread: commsGetThread,
  comms_send_message: commsSendMessage,
  comms_take_over: commsTakeOver,
  comms_hand_back: commsHandBack,
};

const tools = withSecurity([
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
    name: "shopify_record_order_timeline_entry",
    title: "Record Shopify order timeline entry",
    description:
      "Record a concise PaintAccess Operations Desk entry in the Shopify order timeline without leaving the text in the persistent order Notes field. Does not cancel, refund, send email, edit line items, or complete fulfilment.",
    inputSchema: objectSchema(
      {
        ...orderIdentifierProps(),
        note_type: stringProp("Controlled timeline entry type, e.g. po_drafted, tracking_received, manual_action_required."),
        summary: stringProp("Concise Shopify-timeline-style operational summary to record."),
        source: stringProp("Source of action, e.g. ChatGPT Operations Desk, Gmail app, Daniel approval."),
        supplier: stringProp("Supplier name when relevant."),
        next_action: stringProp("Next operational action."),
        copy_text: stringProp("Optional concise supporting detail. Do not paste full email bodies unless explicitly required."),
        approval_reference: stringProp("Approval reference if the timeline entry records an approved action."),
        request_id: stringProp("Optional stable idempotency key. Reuse the same value when retrying after an approval/auth timeout."),
      },
      ["summary"]
    ),
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "shopify_add_order_note",
    title: "Deprecated alias: record Shopify order timeline entry",
    description:
      "Compatibility alias for shopify_record_order_timeline_entry. Use the timeline tool name in new workflows. This does not leave operations text in the persistent Shopify Notes field.",
    inputSchema: objectSchema(
      {
        ...orderIdentifierProps(),
        note_type: stringProp("Controlled timeline entry type, e.g. po_drafted, tracking_received, manual_action_required."),
        summary: stringProp("Concise Shopify-timeline-style operational summary to record."),
        source: stringProp("Source of action, e.g. ChatGPT Operations Desk, Gmail app, Daniel approval."),
        supplier: stringProp("Supplier name when relevant."),
        next_action: stringProp("Next operational action."),
        copy_text: stringProp("Optional concise supporting detail. Do not paste full email bodies unless explicitly required."),
        approval_reference: stringProp("Approval reference if the timeline entry records an approved action."),
        request_id: stringProp("Optional stable idempotency key. Reuse the same value when retrying after an approval/auth timeout."),
      },
      ["summary"]
    ),
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "shopify_remove_order_note_entry",
    title: "Remove Shopify operations note entry",
    description:
      "Remove the latest matching PaintAccess Operations note entry from a known Shopify order. Use for correcting or reverting agent-added ops notes only.",
    inputSchema: objectSchema(
      {
        ...orderIdentifierProps(),
        note_type: stringProp("Optional controlled note type to match."),
        summary_contains: stringProp("Text that must appear in the note entry to remove."),
        reason: stringProp("Reason for removing the note entry."),
      },
      ["summary_contains"]
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
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: "shopify_complete_fulfillment",
    title: "Complete Shopify fulfilment",
    description:
      "Complete final Shopify fulfilment for a known order with tracking. Requires approval_reference. Blocks non-test orders unless allow_live_order is true. Defaults notify_customer to false.",
    inputSchema: objectSchema(
      {
        ...orderIdentifierProps(),
        tracking_number: stringProp("Tracking number to attach to the fulfilment."),
        tracking_company: stringProp("Carrier/company name."),
        tracking_url: stringProp("Tracking URL."),
        notify_customer: booleanProp("Whether Shopify should notify the customer. Defaults false."),
        approval_reference: stringProp("Required approval reference before completing fulfilment."),
        allow_live_order: booleanProp("Only true after Daniel explicitly approves final fulfilment on a non-test order."),
        message: stringProp("Optional internal fulfilment message."),
      },
      ["tracking_number", "approval_reference"]
    ),
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  {
    name: "shopify_prepare_cancellation",
    title: "Prepare cancellation/refund",
    description:
      "Prepare a cancellation/refund readiness report and suggested Shopify order timeline entry. Does not cancel, refund, or delete the order.",
    inputSchema: objectSchema(
      {
        ...orderIdentifierProps(),
        reason: stringProp("Reason for cancellation/refund preparation."),
        customer_request_source: stringProp("Source of request, e.g. customer email, phone, staff note."),
      },
      ["reason"]
    ),
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: "shopify_prepare_customer_email",
    title: "Prepare Shopify email template",
    description:
      "Prepare a PaintAccess email from Shopify order details. Does not send. Use before Gmail draft/send or Shopify native email send.",
    inputSchema: objectSchema(
      {
        ...orderIdentifierProps(),
        template_type: enumProp("Template type.", [
          "order_processing",
          "stock_delay",
          "supplier_po",
          "tracking_update",
          "cancellation_reply",
          "custom",
        ]),
        recipient_type: enumProp("Recipient type.", ["customer", "supplier", "internal"]),
        supplier: stringProp("Supplier name for supplier PO emails."),
        custom_message: stringProp("Optional custom message to include."),
      },
      ["template_type"]
    ),
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: "shopify_send_customer_email",
    title: "Send Shopify native email",
    description:
      "Send a customer email through Shopify's branded native notification layer. Defaults to existing-order invoice email for customers and draft-order invoice only for supplier/fallback use. Requires approval_reference.",
    inputSchema: objectSchema(
      {
        ...orderIdentifierProps(),
        to: stringProp("Recipient email. Defaults to order customer email when omitted."),
        delivery_method: enumProp("Shopify delivery method. order_invoice uses the existing order invoice notification template; draft_order_invoice uses the legacy draft-order invoice fallback.", [
          "order_invoice",
          "draft_order_invoice",
        ]),
        template_type: enumProp("Template type.", [
          "order_processing",
          "stock_delay",
          "supplier_po",
          "tracking_update",
          "cancellation_reply",
          "custom",
        ]),
        recipient_type: enumProp("Recipient type.", ["customer", "supplier", "internal"]),
        supplier: stringProp("Supplier name for supplier PO emails."),
        subject: stringProp("Optional subject override."),
        body_text: stringProp("Optional body override."),
        custom_message: stringProp("Optional custom message to include."),
        include_plain_signature: booleanProp("Only true if the custom message should include the plain PaintAccess signoff. Defaults false for Shopify templates because Shopify adds branded footer/logo."),
        fallback_to_draft_order_invoice: booleanProp("If true, try the draft-order invoice fallback when the existing-order invoice send returns Shopify user errors."),
        approval_reference: stringProp("Required approval reference from Daniel before sending."),
      },
      ["template_type", "approval_reference"]
    ),
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  },
  {
    name: "gmail_search_messages",
    title: "Search Gmail messages",
    description:
      "Search the backend-authorized PaintAccess Gmail mailbox for supplier confirmations, tracking messages, customer replies, or order threads.",
    inputSchema: objectSchema({
      query: stringProp("Gmail search query."),
      order_number: stringProp("Order number to include in search."),
      from: stringProp("Sender filter."),
      to: stringProp("Recipient filter."),
      subject: stringProp("Subject filter."),
      after: stringProp("After date, e.g. 2026/06/01."),
      before: stringProp("Before date, e.g. 2026/06/30."),
      max_results: numberProp("Maximum messages, 1-25."),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: "gmail_get_message",
    title: "Get Gmail message",
    description: "Read one backend-authorized Gmail message by ID and return headers, snippet, and text preview.",
    inputSchema: objectSchema(
      {
        message_id: stringProp("Gmail message ID."),
      },
      ["message_id"]
    ),
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: "gmail_create_draft",
    title: "Create Gmail draft",
    description:
      "Create a Gmail draft in the backend-authorized PaintAccess mailbox. Does not send email.",
    inputSchema: objectSchema(
      {
        to: stringProp("Recipient email address."),
        cc: stringProp("Optional CC recipients."),
        bcc: stringProp("Optional BCC recipients."),
        subject: stringProp("Email subject."),
        body_text: stringProp("Plain text email body."),
      },
      ["to", "subject", "body_text"]
    ),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "gmail_send_email",
    title: "Send Gmail email",
    description:
      "Send an email from the backend-authorized PaintAccess Gmail mailbox. Requires approval_reference.",
    inputSchema: objectSchema(
      {
        to: stringProp("Recipient email address."),
        cc: stringProp("Optional CC recipients."),
        bcc: stringProp("Optional BCC recipients."),
        subject: stringProp("Email subject."),
        body_text: stringProp("Plain text email body."),
        approval_reference: stringProp("Required approval reference from Daniel before sending."),
      },
      ["to", "subject", "body_text", "approval_reference"]
    ),
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  },
  {
    name: "drive_search_files",
    title: "Search Google Drive files",
    description:
      "Search backend-authorized Google Drive files for PO templates, supplier documents, attachments, or shared operations files.",
    inputSchema: objectSchema({
      query: stringProp("Full-text search query."),
      name_contains: stringProp("Filename substring."),
      mime_type: stringProp("Exact MIME type."),
      folder_id: stringProp("Drive folder ID."),
      max_results: numberProp("Maximum files, 1-25."),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: "drive_get_file",
    title: "Get Google Drive file",
    description:
      "Read metadata and optional text/export preview for one backend-authorized Google Drive file.",
    inputSchema: objectSchema(
      {
        file_id: stringProp("Google Drive file ID."),
        include_content: booleanProp("Whether to include text/export preview. Defaults true."),
        export_mime_type: stringProp("Export MIME type for Google Docs files, defaults text/plain."),
      },
      ["file_id"]
    ),
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: "drive_create_text_file",
    title: "Create Google Drive text file",
    description:
      "Create a small text/markdown/plain file in backend-authorized Google Drive for PO drafts or operation notes.",
    inputSchema: objectSchema(
      {
        name: stringProp("Filename."),
        content: stringProp("File content."),
        mime_type: stringProp("MIME type, defaults text/plain."),
        folder_id: stringProp("Optional target folder ID."),
      },
      ["name", "content"]
    ),
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "comms_search_threads",
    title: "Search communication threads",
    description:
      "Search the unified communications inbox (SMS, WhatsApp, chat, voice) for customer conversation threads by name, phone, email, or message text. Read-only.",
    inputSchema: objectSchema({
      query: stringProp("Free-text search over contact name, phone, email, and last message."),
      channel: enumProp("Optional channel filter.", ["sms", "whatsapp", "email", "chat", "voice"]),
      status: enumProp("Optional thread status filter.", ["open", "closed", "snoozed"]),
      limit: numberProp("Maximum threads to return, 1-100."),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: "comms_get_thread",
    title: "Get communication thread",
    description:
      "Read one customer's full cross-channel conversation history (all messages, directions, statuses). Identify the thread by thread_id, phone, or email. Read-only.",
    inputSchema: objectSchema({
      thread_id: stringProp("Thread id from comms_search_threads."),
      phone: stringProp("Customer phone in E.164, e.g. +61400000000."),
      email: stringProp("Customer email address."),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: "comms_send_message",
    title: "Send customer message",
    description:
      "Send an SMS or WhatsApp message to a customer as a human agent and log it to the conversation. Identify the recipient by thread_id, phone, or email. Requires approval_reference. WhatsApp free text only works inside the 24h customer service window.",
    inputSchema: objectSchema(
      {
        channel: enumProp("Channel to send on.", ["sms", "whatsapp"]),
        thread_id: stringProp("Thread id to reply into."),
        phone: stringProp("Recipient phone in E.164 (overrides thread lookup)."),
        email: stringProp("Recipient email to resolve the thread (used only to find the phone)."),
        body: stringProp("Message text to send."),
        approval_reference: stringProp("Required approval reference before sending a customer message."),
      },
      ["channel", "body", "approval_reference"]
    ),
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  },
  {
    name: "comms_take_over",
    title: "Take over conversation from AI",
    description:
      "Pause the AI on a customer thread so a human owns the conversation — the AI stops auto-replying to inbound messages. Identify by thread_id, phone, or email.",
    inputSchema: objectSchema({
      thread_id: stringProp("Thread id."),
      phone: stringProp("Customer phone in E.164."),
      email: stringProp("Customer email address."),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "comms_hand_back",
    title: "Hand conversation back to AI",
    description:
      "Return a customer thread to AI control so the AI resumes auto-replying to inbound messages. Identify by thread_id, phone, or email.",
    inputSchema: objectSchema({
      thread_id: stringProp("Thread id."),
      phone: stringProp("Customer phone in E.164."),
      email: stringProp("Customer email address."),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
]);

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    return res.status(200).json({
      name: "PaintAccess Operations MCP",
      version: "1.1.0",
      endpoint: "/api/mcp/shopify",
      tools: tools.map((tool) => tool.name),
      instructions: SERVER_INSTRUCTIONS,
      auth: protectedResourceMetadata(req),
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (await rateLimit(req, res)) return;

  const auth = verifyMcpRequest(req);
  if (!auth.ok) {
    return sendUnauthorized(req, res, auth.reason);
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
          name: "paintaccess-operations",
          title: "PaintAccess Operations",
          version: "1.1.0",
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
  if (result?.threads) return `Found ${result.threads.length} conversation thread(s).`;
  if (result?.conversation && result?.messages) {
    return `Conversation ${result.conversation.thread_id}: ${result.messages.length} message(s).`;
  }
  if (result?.sent && result?.channel) {
    return `Sent ${result.channel} message${result.to ? ` to ${result.to}` : ""}.`;
  }
  if (result?.control_mode && result?.thread_id) {
    return `Thread ${result.thread_id} set to ${result.control_mode} control.`;
  }
  if (result?.orders) return `Found ${result.orders.length} Shopify order(s).`;
  if (result?.messages) return `Found ${result.messages.length} Gmail message(s).`;
  if (result?.files) return `Found ${result.files.length} Google Drive file(s).`;
  if (result?.draft_id) return `Created Gmail draft ${result.draft_id}.`;
  if (result?.sent && result?.provider) return `Sent email via ${result.provider}.`;
  if (result?.fulfilled && result?.fulfillment?.id) return `Completed fulfilment for ${result.order_number}.`;
  if (result?.subject && result?.body_text) return `Prepared email template: ${result.subject}.`;
  if (result?.order_number && result?.ok === false) {
    return result.message || `Action not completed for ${result.order_number}.`;
  }
  if (result?.order_number && result?.duplicate) {
    return result.message || `Matching action already exists for ${result.order_number}.`;
  }
  if (result?.order_number && result?.tag) {
    return `${result.ok ? "Updated" : "Checked"} ${result.order_number}: ${result.tag}.`;
  }
  if (result?.order_number && result?.timeline_entry_added) {
    return `Recorded Operations Desk timeline activity for ${result.order_number}.`;
  }
  if (result?.order_number && result?.removed) {
    return `Removed matching Operations Desk note entry from ${result.order_number}.`;
  }
  if (result?.order_number && result?.approval_required) {
    return `Prepared action for ${result.order_number}. Daniel approval required before final execution.`;
  }
  if (result?.order_number) return `Retrieved ${result.order_number}.`;
  return "Tool completed.";
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

function withSecurity(toolList) {
  return toolList.map((tool) => ({
    ...tool,
    annotations: normalizeAnnotations(tool.annotations),
    securitySchemes: SECURITY_SCHEMES,
    _meta: {
      ...(tool._meta || {}),
      securitySchemes: SECURITY_SCHEMES,
    },
  }));
}

function normalizeAnnotations(annotations = {}) {
  const readOnlyHint = annotations.readOnlyHint === true;
  return {
    readOnlyHint,
    destructiveHint: annotations.destructiveHint === true,
    openWorldHint: annotations.openWorldHint === true,
  };
}
