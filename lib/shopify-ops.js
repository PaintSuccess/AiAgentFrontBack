const { cleanEnv, shopifyFetch } = require("./shopify");
const { buildOrderEmailTemplate } = require("./paintaccess-email-templates");

const SHOPIFY_STORE = cleanEnv("SHOPIFY_STORE");
const SHOPIFY_ACCESS_TOKEN = cleanEnv("SHOPIFY_ACCESS_TOKEN");
const SHOPIFY_ADMIN_API_VERSION =
  cleanEnv("SHOPIFY_ADMIN_API_VERSION") || "2026-04";

const OPS_NAMESPACE = "paintaccess_ops";

const CONTROLLED_TAGS = [
  "PO draft prepared",
  "PO sent",
  "Sales Confirmation checked",
  "Sales Confirmation mismatch",
  "Payment approval required",
  "Payment approved",
  "Payment processed",
  "Tracking received",
  "Fulfilment prepared",
  "Customer emailed - stock delay",
  "Awaiting customer confirmation",
  "Manual action required",
];

const OPS_METAFIELD_KEYS = [
  "po_status",
  "po_suppliers",
  "supplier_confirmation_status",
  "payment_status",
  "tracking_status",
  "fulfillment_prep_status",
  "last_agent_action",
];

function requireShopifyConfig() {
  if (!SHOPIFY_STORE || !SHOPIFY_ACCESS_TOKEN) {
    const err = new Error(
      "Shopify credentials are not configured (SHOPIFY_STORE / SHOPIFY_ACCESS_TOKEN)."
    );
    err.statusCode = 500;
    throw err;
  }
}

async function shopifyOpsGraphQL(query, variables = {}) {
  requireShopifyConfig();

  const url = `https://${SHOPIFY_STORE}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Shopify GraphQL ${res.status}: ${text}`);
    err.statusCode = res.status;
    err.upstream = text;
    throw err;
  }

  const json = await res.json();
  if (json.errors?.length) {
    const err = new Error(`Shopify GraphQL errors: ${JSON.stringify(json.errors)}`);
    err.statusCode = 502;
    err.graphqlErrors = json.errors;
    throw err;
  }

  return json.data;
}

function safeText(value, maxLength = 500) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[<>`]/g, "")
    .replace(/\s{3,}/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeOrderNumber(value) {
  const raw = safeText(value, 40);
  if (!raw) return "";
  const digits = raw.replace(/^#/, "").replace(/[^\d]/g, "");
  return digits ? `#${digits}` : raw;
}

function isOrderGid(value) {
  return /^gid:\/\/shopify\/Order\/\d+$/.test(String(value || ""));
}

function escapeSearchValue(value) {
  return String(value || "").replace(/["\\]/g, " ").trim();
}

function buildOrderSearchQuery(input = {}) {
  const parts = [];
  const orderNumber = normalizeOrderNumber(input.order_number);
  if (orderNumber) parts.push(`name:${orderNumber}`);
  if (input.customer_email) parts.push(`email:${escapeSearchValue(input.customer_email)}`);
  if (input.customer_name) parts.push(escapeSearchValue(input.customer_name));
  if (input.financial_status) {
    parts.push(`financial_status:${escapeSearchValue(input.financial_status).toLowerCase()}`);
  }
  if (input.fulfillment_status) {
    parts.push(`fulfillment_status:${escapeSearchValue(input.fulfillment_status).toLowerCase()}`);
  }
  if (input.tag) parts.push(`tag:"${escapeSearchValue(input.tag)}"`);
  if (input.created_at_min) parts.push(`created_at:>=${escapeSearchValue(input.created_at_min)}`);
  if (input.created_at_max) parts.push(`created_at:<=${escapeSearchValue(input.created_at_max)}`);
  if (input.query) parts.push(escapeSearchValue(input.query));
  return parts.join(" ").trim() || "status:any";
}

function money(set) {
  const amount = set?.shopMoney?.amount;
  const currency = set?.shopMoney?.currencyCode;
  return amount == null ? null : `${amount} ${currency || ""}`.trim();
}

function mapAddress(address) {
  if (!address) return null;
  return {
    name: address.name || null,
    company: address.company || null,
    address1: address.address1 || null,
    address2: address.address2 || null,
    city: address.city || null,
    province: address.province || null,
    zip: address.zip || null,
    country: address.country || null,
    phone: address.phone || null,
  };
}

function edgesToNodes(connection) {
  return (connection?.edges || []).map((edge) => edge.node).filter(Boolean);
}

function mapLineItem(item) {
  return {
    id: item.id,
    title: item.title || item.name || null,
    sku: item.sku || item.variant?.sku || null,
    vendor: item.vendor || item.product?.vendor || null,
    quantity: item.quantity ?? item.totalQuantity ?? null,
    remaining_quantity: item.remainingQuantity ?? null,
    variant_title: item.variantTitle || item.variant?.displayName || null,
    product_title: item.product?.title || item.variant?.product?.title || null,
    product_type: item.product?.productType || null,
    product_tags: item.product?.tags || [],
    price: money(item.originalUnitPriceSet),
  };
}

function mapOrderSummary(order) {
  return {
    id: order.id,
    order_number: order.name,
    created_at: order.createdAt,
    customer_name: order.customer?.displayName || order.shippingAddress?.name || null,
    customer_email: order.email || order.customer?.email || null,
    financial_status: order.displayFinancialStatus || null,
    fulfillment_status: order.displayFulfillmentStatus || null,
    total: money(order.totalPriceSet),
    tags: order.tags || [],
    note: order.note || null,
    line_items: edgesToNodes(order.lineItems).map(mapLineItem),
  };
}

function mapOrderDetail(order) {
  return {
    ...mapOrderSummary(order),
    customer_phone: order.customer?.phone || null,
    shipping_address: mapAddress(order.shippingAddress),
    metafields: edgesToNodes(order.metafields).map((field) => ({
      id: field.id,
      namespace: field.namespace,
      key: field.key,
      value: field.value,
      type: field.type,
      updated_at: field.updatedAt,
    })),
  };
}

const ORDER_SUMMARY_FIELDS = `
  id
  name
  createdAt
  email
  displayFinancialStatus
  displayFulfillmentStatus
  tags
  note
  totalPriceSet { shopMoney { amount currencyCode } }
  customer { displayName email phone }
  shippingAddress { name company address1 address2 city province zip country phone }
  lineItems(first: 25) {
    edges {
      node {
        id
        title
        quantity
        sku
        vendor
        variantTitle
        originalUnitPriceSet { shopMoney { amount currencyCode } }
        product { id title vendor productType tags }
      }
    }
  }
`;

const SEARCH_ORDERS_QUERY = `
  query SearchOrders($query: String!, $first: Int!) {
    orders(first: $first, query: $query, sortKey: CREATED_AT, reverse: true) {
      edges { node { ${ORDER_SUMMARY_FIELDS} } }
    }
  }
`;

const GET_ORDER_QUERY = `
  query GetOrder($id: ID!) {
    order(id: $id) {
      ${ORDER_SUMMARY_FIELDS}
      metafields(first: 20, namespace: "${OPS_NAMESPACE}") {
        edges { node { id namespace key value type updatedAt } }
      }
    }
  }
`;

const FULFILLMENT_READINESS_QUERY = `
  query FulfillmentReadiness($id: ID!) {
    order(id: $id) {
      id
      name
      displayFulfillmentStatus
      fulfillmentOrders(first: 10) {
        edges {
          node {
            id
            status
            requestStatus
            assignedLocation {
              name
            }
            lineItems(first: 50) {
              edges {
                node {
                  id
                  totalQuantity
                  remainingQuantity
                  lineItem {
                    id
                    name
                    sku
                    quantity
                    variant {
                      id
                      sku
                      displayName
                      product { title vendor }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

async function searchOrders(input = {}) {
  const first = Math.min(Math.max(parseInt(input.limit, 10) || 10, 1), 25);
  const query = buildOrderSearchQuery(input);
  const data = await shopifyOpsGraphQL(SEARCH_ORDERS_QUERY, { query, first });
  const orders = edgesToNodes(data.orders).map(mapOrderSummary);

  return {
    query,
    count: orders.length,
    exact_match:
      Boolean(input.order_number) &&
      orders.length === 1 &&
      orders[0].order_number === normalizeOrderNumber(input.order_number),
    orders,
  };
}

async function resolveOrder(input = {}) {
  const id = safeText(input.order_id || input.id, 120);
  if (isOrderGid(id)) {
    const data = await shopifyOpsGraphQL(GET_ORDER_QUERY, { id });
    if (!data.order) {
      const err = new Error("Order not found.");
      err.code = "order_not_found";
      err.statusCode = 404;
      throw err;
    }
    return mapOrderDetail(data.order);
  }

  const orderNumber = normalizeOrderNumber(input.order_number || input.name);
  if (!orderNumber) {
    const err = new Error("Provide order_id or order_number.");
    err.code = "missing_order_identifier";
    err.statusCode = 400;
    throw err;
  }

  const result = await searchOrders({ order_number: orderNumber, limit: 2 });
  if (result.orders.length === 0) {
    const err = new Error(`Order ${orderNumber} not found.`);
    err.code = "order_not_found";
    err.statusCode = 404;
    throw err;
  }
  if (result.orders.length > 1) {
    const err = new Error(`Order ${orderNumber} is ambiguous.`);
    err.code = "ambiguous_order";
    err.statusCode = 409;
    err.candidates = result.orders;
    throw err;
  }
  return getOrder({ order_id: result.orders[0].id });
}

async function getOrder(input = {}) {
  const id = safeText(input.order_id || input.id, 120);
  if (!isOrderGid(id)) return resolveOrder(input);

  const data = await shopifyOpsGraphQL(GET_ORDER_QUERY, { id });
  if (!data.order) {
    const err = new Error("Order not found.");
    err.code = "order_not_found";
    err.statusCode = 404;
    throw err;
  }
  return mapOrderDetail(data.order);
}

function buildOpsNote(input = {}, order) {
  const timestamp = new Date().toISOString();
  const type = safeText(input.note_type || "operations_note", 80);
  const summary = safeText(input.summary, 1200);
  const source = safeText(input.source || "ChatGPT Operations Desk", 120);
  const supplier = safeText(input.supplier, 120);
  const nextAction = safeText(input.next_action, 500);
  const approvalReference = safeText(input.approval_reference, 200);
  const copyText = safeText(input.copy_text, 1800);

  const parts = [
    `[PaintAccess Ops ${timestamp}]`,
    `Type: ${type}`,
    `Order: ${order.order_number}`,
    `Source: ${source}`,
  ];
  if (supplier) parts.push(`Supplier: ${supplier}`);
  if (summary) parts.push(`Summary: ${summary}`);
  if (nextAction) parts.push(`Next action: ${nextAction}`);
  if (approvalReference) parts.push(`Approval: ${approvalReference}`);
  if (copyText) parts.push(`Copy:\n${copyText}`);
  return parts.join("\n");
}

function appendNote(existing, addition) {
  const current = safeText(existing, 3000);
  const next = current ? `${current}\n\n${addition}` : addition;
  return next.slice(-4500);
}

const ORDER_UPDATE_MUTATION = `
  mutation UpdateOrder($input: OrderInput!) {
    orderUpdate(input: $input) {
      order { id name note tags }
      userErrors { field message }
    }
  }
`;

async function addOrderNote(input = {}) {
  const order = await getOrder(input);
  const addition = buildOpsNote(input, order);
  const note = appendNote(order.note, addition);
  const data = await shopifyOpsGraphQL(ORDER_UPDATE_MUTATION, {
    input: { id: order.id, note },
  });
  const payload = data.orderUpdate;
  const userErrors = payload?.userErrors || [];
  audit("shopify_add_order_note", input, {
    order_id: order.id,
    order_number: order.order_number,
    user_errors: userErrors,
  });

  return {
    ok: userErrors.length === 0,
    order_id: order.id,
    order_number: order.order_number,
    note_added: addition,
    user_errors: userErrors,
  };
}

async function removeOrderNoteEntry(input = {}) {
  const order = await getOrder(input);
  const note = String(order.note || "");
  const matchText = safeText(input.summary_contains || input.entry_contains, 300);
  const noteType = safeText(input.note_type, 80);
  if (!matchText && !noteType) {
    const err = new Error("Provide summary_contains or note_type to remove a specific Operations Desk note entry.");
    err.code = "missing_note_match";
    err.statusCode = 400;
    throw err;
  }

  const entries = splitOpsNoteEntries(note);
  let removeIndex = -1;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.type !== "ops") continue;
    const matchesText = !matchText || entry.text.includes(matchText);
    const matchesType = !noteType || entry.text.includes(`Type: ${noteType}`);
    if (matchesText && matchesType) {
      removeIndex = index;
      break;
    }
  }

  if (removeIndex === -1) {
    return {
      ok: false,
      order_id: order.id,
      order_number: order.order_number,
      removed: false,
      message: "No matching PaintAccess Operations note entry was found.",
    };
  }

  const removedEntry = entries.splice(removeIndex, 1)[0].text;
  const restoredNote = entries.map((entry) => entry.text).join("\n\n").trim();
  const data = await shopifyOpsGraphQL(ORDER_UPDATE_MUTATION, {
    input: { id: order.id, note: restoredNote },
  });
  const userErrors = data.orderUpdate?.userErrors || [];
  audit("shopify_remove_order_note_entry", input, {
    order_id: order.id,
    order_number: order.order_number,
    user_errors: userErrors,
  });

  return {
    ok: userErrors.length === 0,
    order_id: order.id,
    order_number: order.order_number,
    removed: userErrors.length === 0,
    removed_preview: removedEntry.slice(0, 600),
    user_errors: userErrors,
  };
}

function splitOpsNoteEntries(note) {
  const raw = String(note || "").trim();
  if (!raw) return [];
  const marker = "[PaintAccess Ops ";
  const indexes = [];
  let pos = raw.indexOf(marker);
  while (pos !== -1) {
    indexes.push(pos);
    pos = raw.indexOf(marker, pos + marker.length);
  }
  if (!indexes.length) return [{ type: "other", text: raw }];

  const entries = [];
  if (indexes[0] > 0) {
    entries.push({ type: "other", text: raw.slice(0, indexes[0]).trim() });
  }
  for (let i = 0; i < indexes.length; i += 1) {
    const start = indexes[i];
    const end = indexes[i + 1] || raw.length;
    entries.push({ type: "ops", text: raw.slice(start, end).trim() });
  }
  return entries.filter((entry) => entry.text);
}

function normalizeControlledTag(input = {}) {
  const raw = safeText(input.tag, 120);
  const supplier = safeText(input.supplier, 80);
  if (!raw) {
    const err = new Error("tag is required.");
    err.code = "missing_tag";
    err.statusCode = 400;
    throw err;
  }

  if (raw === "PO sent" && supplier) return `PO sent - ${supplier}`;
  if (raw.startsWith("PO sent - ")) return raw;
  if (CONTROLLED_TAGS.includes(raw)) return raw;

  const err = new Error(`Tag "${raw}" is not in the controlled Operations Desk tag set.`);
  err.code = "invalid_controlled_tag";
  err.statusCode = 400;
  throw err;
}

function detectDuplicateRisk(order, tag) {
  if (!tag.startsWith("PO sent")) return null;
  const duplicate = (order.tags || []).find((existing) => existing === tag || existing === "PO sent");
  return duplicate
    ? {
        duplicate_risk: true,
        existing_marker: duplicate,
        message: `Order ${order.order_number} already has ${duplicate}.`,
      }
    : null;
}

const TAGS_ADD_MUTATION = `
  mutation TagsAdd($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
      node { id }
      userErrors { field message }
    }
  }
`;

const TAGS_REMOVE_MUTATION = `
  mutation TagsRemove($id: ID!, $tags: [String!]!) {
    tagsRemove(id: $id, tags: $tags) {
      node { id }
      userErrors { field message }
    }
  }
`;

async function addOrderTag(input = {}) {
  const order = await getOrder(input);
  const tag = normalizeControlledTag(input);
  const duplicate = detectDuplicateRisk(order, tag);
  if (duplicate && input.override_duplicate !== true) {
    return {
      ok: false,
      order_id: order.id,
      order_number: order.order_number,
      tag,
      ...duplicate,
      next_action: "Ask Daniel to confirm this is a resend or correction before overriding.",
    };
  }

  const data = await shopifyOpsGraphQL(TAGS_ADD_MUTATION, {
    id: order.id,
    tags: [tag],
  });
  const userErrors = data.tagsAdd?.userErrors || [];
  audit("shopify_add_order_tag", input, {
    order_id: order.id,
    order_number: order.order_number,
    tag,
    user_errors: userErrors,
  });

  return {
    ok: userErrors.length === 0,
    order_id: order.id,
    order_number: order.order_number,
    tag,
    user_errors: userErrors,
  };
}

async function removeOrderTag(input = {}) {
  const order = await getOrder(input);
  const tag = normalizeControlledTag(input);
  const data = await shopifyOpsGraphQL(TAGS_REMOVE_MUTATION, {
    id: order.id,
    tags: [tag],
  });
  const userErrors = data.tagsRemove?.userErrors || [];
  audit("shopify_remove_order_tag", input, {
    order_id: order.id,
    order_number: order.order_number,
    tag,
    user_errors: userErrors,
  });

  return {
    ok: userErrors.length === 0,
    order_id: order.id,
    order_number: order.order_number,
    tag,
    user_errors: userErrors,
  };
}

const METAFIELDS_SET_MUTATION = `
  mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id namespace key value type updatedAt }
      userErrors { field message code }
    }
  }
`;

async function setOpsMetafield(input = {}) {
  const order = await getOrder(input);
  const key = safeText(input.key, 80);
  if (!OPS_METAFIELD_KEYS.includes(key)) {
    const err = new Error(`Metafield key "${key}" is not allowed.`);
    err.code = "invalid_ops_metafield_key";
    err.statusCode = 400;
    throw err;
  }

  const value =
    typeof input.value === "string"
      ? safeText(input.value, 2000)
      : JSON.stringify(input.value ?? "");
  const data = await shopifyOpsGraphQL(METAFIELDS_SET_MUTATION, {
    metafields: [
      {
        ownerId: order.id,
        namespace: OPS_NAMESPACE,
        key,
        type: "single_line_text_field",
        value: value.slice(0, 255),
      },
    ],
  });
  const payload = data.metafieldsSet;
  audit("shopify_set_ops_metafield", input, {
    order_id: order.id,
    order_number: order.order_number,
    key,
    user_errors: payload?.userErrors || [],
  });

  return {
    ok: (payload?.userErrors || []).length === 0,
    order_id: order.id,
    order_number: order.order_number,
    metafields: payload?.metafields || [],
    user_errors: payload?.userErrors || [],
  };
}

async function getFulfillmentReadiness(input = {}) {
  const order = await getOrder(input);
  const data = await shopifyOpsGraphQL(FULFILLMENT_READINESS_QUERY, { id: order.id });
  const fulfillmentOrders = edgesToNodes(data.order?.fulfillmentOrders).map((fo) => ({
    id: fo.id,
    status: fo.status,
    request_status: fo.requestStatus,
    assigned_location: fo.assignedLocation
      ? {
          name: fo.assignedLocation.name,
        }
      : null,
    line_items: edgesToNodes(fo.lineItems).map((item) => ({
      id: item.id,
      total_quantity: item.totalQuantity,
      remaining_quantity: item.remainingQuantity,
      line_item: mapLineItem(item.lineItem || {}),
    })),
  }));

  const ready = fulfillmentOrders.some((fo) =>
    ["OPEN", "IN_PROGRESS", "SCHEDULED"].includes(String(fo.status || "").toUpperCase())
  );

  return {
    order_id: order.id,
    order_number: order.order_number,
    fulfillment_status: data.order?.displayFulfillmentStatus || order.fulfillment_status,
    ready_for_preparation: ready,
    fulfillment_orders: fulfillmentOrders,
    warnings: ready
      ? []
      : ["No open fulfillment order was found. Review Shopify Admin before preparing tracking."],
  };
}

async function prepareFulfillment(input = {}) {
  const readiness = await getFulfillmentReadiness(input);
  const trackingNumber = safeText(input.tracking_number, 120);
  const trackingCompany = safeText(input.tracking_company, 120);
  const trackingUrl = safeText(input.tracking_url, 500);
  const notifyCustomer = input.notify_customer === true;

  return {
    ok: readiness.ready_for_preparation && Boolean(trackingNumber),
    order_id: readiness.order_id,
    order_number: readiness.order_number,
    approval_required: true,
    final_fulfillment_completed: false,
    notify_customer: notifyCustomer,
    tracking_preview: {
      tracking_number: trackingNumber || null,
      tracking_company: trackingCompany || null,
      tracking_url: trackingUrl || null,
    },
    fulfillment_orders: readiness.fulfillment_orders,
    warnings: [
      ...readiness.warnings,
      ...(trackingNumber ? [] : ["tracking_number is required before final fulfilment."]),
      "This tool only prepares a fulfilment preview. Daniel approval is required before final fulfilment.",
    ],
  };
}

async function prepareCancellation(input = {}) {
  const order = await getOrder(input);
  const reason = safeText(input.reason || "customer request", 300);
  const source = safeText(input.customer_request_source || "unknown", 200);
  const paid = String(order.financial_status || "").toLowerCase().includes("paid");
  const unfulfilled = String(order.fulfillment_status || "").toLowerCase().includes("unfulfilled");

  return {
    ok: true,
    order_id: order.id,
    order_number: order.order_number,
    approval_required: true,
    cancellation_executed: false,
    refund_executed: false,
    current_status: {
      financial_status: order.financial_status,
      fulfillment_status: order.fulfillment_status,
    },
    readiness: {
      appears_paid: paid,
      appears_unfulfilled: unfulfilled,
      manual_review_required: true,
    },
    suggested_note: buildOpsNote(
      {
        note_type: "cancellation_refund_preparation",
        summary: `Cancellation/refund requested. Reason: ${reason}. Request source: ${source}.`,
        next_action: "Daniel to review and complete cancellation/refund manually in Shopify Admin.",
        source: "ChatGPT Operations Desk",
      },
      order
    ),
    manual_steps: [
      "Open the order in Shopify Admin.",
      "Confirm payment, fulfilment, and customer request details.",
      "Cancel/refund manually if appropriate.",
      "Record the final action in Shopify notes/tags.",
    ],
  };
}

async function prepareCustomerEmail(input = {}) {
  const order = await getOrder(input);
  const template = buildOrderEmailTemplate({
    order,
    template_type: input.template_type,
    recipient_type: input.recipient_type,
    supplier: input.supplier,
    custom_message: safeText(input.custom_message, 2000),
  });

  return {
    ok: true,
    order_id: order.id,
    order_number: order.order_number,
    customer_email: order.customer_email,
    recipient_type: input.recipient_type || "customer",
    template_type: input.template_type || "order_processing",
    subject: template.subject,
    body_text: template.body_text,
    approval_required_before_send: true,
  };
}

async function sendCustomerEmailViaShopify(input = {}) {
  const approvalReference = safeText(input.approval_reference, 200);
  if (!approvalReference) {
    const err = new Error("approval_reference is required before sending an email through Shopify.");
    err.code = "approval_required";
    err.statusCode = 400;
    throw err;
  }

  const prepared = await prepareCustomerEmail(input);
  const to = safeEmail(input.to || prepared.customer_email);
  if (!to) {
    const err = new Error("A valid recipient email is required.");
    err.code = "invalid_recipient";
    err.statusCode = 400;
    throw err;
  }

  const subject = safeText(input.subject || prepared.subject, 240);
  const body = safeText(input.body_text || prepared.body_text, 5000);

  const draftOrder = await shopifyFetch("draft_orders.json", {
    method: "POST",
    body: JSON.stringify({
      draft_order: {
        line_items: [
          {
            title: `PaintAccess email: ${prepared.order_number}`,
            quantity: 1,
            price: "0.00",
          },
        ],
        note: [
          "[PaintAccess Operations Email]",
          `Order: ${prepared.order_number}`,
          `To: ${to}`,
          `Subject: ${subject}`,
          `Approval: ${approvalReference}`,
          "",
          body,
        ].join("\n"),
        email: to,
        tags: "paintaccess-ops,email-request,ai-assistant",
      },
    }),
  });

  const draftId = draftOrder.draft_order?.id;
  if (!draftId) {
    const err = new Error("Shopify draft order was not created for native email send.");
    err.code = "shopify_email_draft_failed";
    err.statusCode = 502;
    throw err;
  }

  const invoice = await shopifyFetch(`draft_orders/${draftId}/send_invoice.json`, {
    method: "POST",
    body: JSON.stringify({
      draft_order_invoice: {
        to,
        subject,
        custom_message: body,
      },
    }),
  });

  audit("shopify_send_customer_email", input, {
    order_id: prepared.order_id,
    order_number: prepared.order_number,
    draft_order_id: draftId,
    to,
    approval_reference: approvalReference,
  });

  return {
    ok: true,
    sent: true,
    provider: "shopify_draft_order_invoice",
    order_id: prepared.order_id,
    order_number: prepared.order_number,
    draft_order_id: draftId,
    to,
    subject,
    approval_reference: approvalReference,
    shopify_response: invoice?.draft_order_invoice ? { invoice_sent: true } : { invoice_sent: true },
  };
}

function safeEmail(value) {
  const email = safeText(value, 320);
  return /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{1,63}$/.test(email) ? email : "";
}

function audit(action, input, result) {
  const redactedInput = { ...input };
  delete redactedInput.token;
  console.info("[PaintAccess Ops Audit]", {
    timestamp: new Date().toISOString(),
    action,
    input: redactedInput,
    result,
  });
}

module.exports = {
  CONTROLLED_TAGS,
  OPS_METAFIELD_KEYS,
  OPS_NAMESPACE,
  addOrderNote,
  addOrderTag,
  getFulfillmentReadiness,
  getOrder,
  prepareCancellation,
  prepareCustomerEmail,
  prepareFulfillment,
  removeOrderTag,
  removeOrderNoteEntry,
  searchOrders,
  sendCustomerEmailViaShopify,
  setOpsMetafield,
};
