const { cleanEnv, shopifyFetch } = require("./shopify");
const { buildOrderEmailTemplate } = require("./paintaccess-email-templates");
const { normalizePhone } = require("./shopify-customer-context");

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

// Gates shopify_complete_fulfillment and shopify_send_customer_email. Deliberately
// NOT in CONTROLLED_TAGS above -- normalizeControlledTag() rejects any tag not on
// that list, so shopify_add_order_tag structurally cannot apply this tag. Only a
// human with direct Shopify Admin access can add it. Cleared automatically after a
// successful gated write (see clearApprovalTag), so each approval is single-use.
const APPROVAL_TAG = "ops-approved";

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

function safeMultilineText(value, maxLength = 5000) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/[<>`]/g, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]{2,}/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, maxLength);
}

function stripPlainPaintAccessSignature(body) {
  return safeMultilineText(body, 5000)
    .replace(
      /\n{2,}(kind regards|warm regards|best regards|thank you|thanks),?\s*\n+(daniel\s*\n+paintaccess|paint\s*access team|paintaccess)\s*$/i,
      ""
    )
    .trim();
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
    customer_id: order.customer?.id || null,
    customer_name: order.customer?.displayName || order.shippingAddress?.name || null,
    customer_email: order.email || order.customer?.email || null,
    // Many orders carry a phone only on the shipping address, so fall back to it —
    // without this, the Orders page can't offer SMS/WhatsApp for those customers.
    //
    // Normalize: `customer.phone` is E.164 already, but `shippingAddress.phone` is
    // free text and is regularly a local AU number ("0407302088", "0481 358 368").
    // Contacts are keyed on E.164, so an un-normalized local number silently fails
    // to match an existing contact — the same person would look like a stranger.
    customer_phone: normalizePhone(order.customer?.phone || order.shippingAddress?.phone) || null,
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
    // customer_phone comes from mapOrderSummary, which also falls back to the
    // shipping address — don't re-set it here or that fallback is lost.
    ...mapOrderSummary(order),
    shipping_address: mapAddress(order.shippingAddress),
    metafields: edgesToNodes(order.metafields).map((field) => ({
      id: field.id,
      namespace: field.namespace,
      key: field.key,
      value: field.value,
      type: field.type,
      updated_at: field.updatedAt,
    })),
    recent_timeline_events: edgesToNodes(order.events).map(mapTimelineEvent),
  };
}

function mapTimelineEvent(event) {
  return {
    id: event.id,
    type: event.__typename || null,
    action: event.action || null,
    app_title: event.appTitle || null,
    created_at: event.createdAt || null,
    message: event.message || null,
    raw_message: event.rawMessage || null,
    secondary_message: event.secondaryMessage || null,
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
  customer { id displayName email phone }
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
  query SearchOrders($query: String!, $first: Int!, $after: String) {
    orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
      edges { node { ${ORDER_SUMMARY_FIELDS} } }
      pageInfo { hasNextPage endCursor }
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
      events(first: 10, reverse: true) {
        edges {
          node {
            __typename
            id
            action
            appTitle
            createdAt
            message
            ... on BasicEvent {
              secondaryMessage
            }
            ... on CommentEvent {
              rawMessage
            }
          }
        }
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
  const after = safeText(input.after, 500) || null;
  const data = await shopifyOpsGraphQL(SEARCH_ORDERS_QUERY, { query, first, after });
  const orders = edgesToNodes(data.orders).map(mapOrderSummary);

  return {
    query,
    count: orders.length,
    exact_match:
      Boolean(input.order_number) &&
      orders.length === 1 &&
      orders[0].order_number === normalizeOrderNumber(input.order_number),
    orders,
    page_info: {
      has_next_page: Boolean(data.orders?.pageInfo?.hasNextPage),
      end_cursor: data.orders?.pageInfo?.endCursor || null,
    },
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

function buildOpsTimelineEntry(input = {}, order) {
  const type = safeText(input.note_type || "operations_note", 80);
  const summary = safeText(input.summary, 1200);
  const source = safeText(input.source || "ChatGPT Operations Desk", 120);
  const supplier = safeText(input.supplier, 120);
  const nextAction = safeText(input.next_action, 500);
  const approvalReference = safeText(input.approval_reference, 200);
  const copyText = safeText(input.copy_text, 1800);
  const requestId = safeText(input.request_id || input.idempotency_key, 120);

  const parts = [
    `PaintAccess Ops: ${summary || type.replace(/_/g, " ")}.`,
  ];
  if (source && source !== "ChatGPT Operations Desk") parts.push(`Source: ${source}.`);
  if (supplier) parts.push(`Supplier: ${supplier}`);
  if (nextAction) parts.push(`Next action: ${nextAction}`);
  if (approvalReference) parts.push(`Approval: ${approvalReference}`);
  if (requestId) parts.push(`Request id: ${requestId}`);
  if (copyText) parts.push(`Details:\n${copyText}`);
  return parts.join("\n");
}

function hasDuplicateOpsTimelineEntry(order, input = {}) {
  const haystack = (order.recent_timeline_events || [])
    .map((event) => [event.message, event.raw_message, event.secondary_message].filter(Boolean).join(" "))
    .join("\n");
  const requestId = safeText(input.request_id || input.idempotency_key, 120);
  if (requestId && haystack.includes(`Request id: ${requestId}`)) return true;

  const summary = safeText(input.summary, 1200);
  if (!summary) return false;

  return haystack.includes(summary);
}

const ORDER_UPDATE_MUTATION = `
  mutation UpdateOrder($input: OrderInput!) {
    orderUpdate(input: $input) {
      order { id name note tags }
      userErrors { field message }
    }
  }
`;

async function updateOrderNote(orderId, note) {
  const data = await shopifyOpsGraphQL(ORDER_UPDATE_MUTATION, {
    input: { id: orderId, note },
  });
  return data.orderUpdate?.userErrors || [];
}

async function addOrderTimelineEntry(input = {}) {
  const order = await getOrder(input);
  if (hasDuplicateOpsTimelineEntry(order, input)) {
    audit("shopify_record_order_timeline_entry_duplicate", input, {
      order_id: order.id,
      order_number: order.order_number,
    });
    return {
      ok: true,
      duplicate: true,
      timeline_entry_added: false,
      order_id: order.id,
      order_number: order.order_number,
      message: "Matching Operations Desk timeline activity already exists; no duplicate entry was recorded.",
    };
  }

  const timelineEntry = buildOpsTimelineEntry(input, order);
  const originalNote = String(order.note || "");
  const writeErrors = await updateOrderNote(order.id, timelineEntry);
  const restoreErrors = writeErrors.length ? [] : await updateOrderNote(order.id, originalNote);
  const userErrors = [...writeErrors, ...restoreErrors];

  audit("shopify_record_order_timeline_entry", input, {
    order_id: order.id,
    order_number: order.order_number,
    write_errors: writeErrors,
    restore_errors: restoreErrors,
  });

  return {
    ok: userErrors.length === 0,
    order_id: order.id,
    order_number: order.order_number,
    timeline_entry_added: userErrors.length === 0 ? timelineEntry : false,
    persistent_note_restored: writeErrors.length === 0 && restoreErrors.length === 0,
    persistent_note_changed: restoreErrors.length > 0,
    user_errors: userErrors,
  };
}

async function addOrderNote(input = {}) {
  return addOrderTimelineEntry(input);
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

function hasApprovalTag(tags) {
  return Array.isArray(tags) && tags.includes(APPROVAL_TAG);
}

// Best-effort cleanup so a stale approval tag can't silently authorize a later,
// unrelated write. Uses the raw mutation directly (not removeOrderTag) because
// removeOrderTag validates against CONTROLLED_TAGS, which APPROVAL_TAG is
// intentionally excluded from. Never throws -- a failed cleanup should not fail
// a write that already succeeded; it just means Daniel needs to remove the tag
// manually before the next approval.
async function clearApprovalTag(orderId) {
  try {
    await shopifyOpsGraphQL(TAGS_REMOVE_MUTATION, { id: orderId, tags: [APPROVAL_TAG] });
  } catch (err) {
    console.error(
      `[shopify-ops] Failed to clear "${APPROVAL_TAG}" tag on ${orderId} after a gated write:`,
      err?.message || err
    );
  }
}

// Best-effort durable audit trail (PRD Phase 1: app logs + Shopify timeline entry,
// ahead of any database). Reuses addOrderTimelineEntry -- defined further below in
// this file, but only referenced here inside a function body, so it's already
// initialized by the time this runs. Never throws: a logging failure must not
// undo or fail a write that already succeeded server-side.
async function recordGatedActionAudit(orderId, { note_type, summary, approval_reference }) {
  try {
    await addOrderTimelineEntry({
      order_id: orderId,
      note_type,
      summary,
      source: "PaintAccess Operations MCP",
      approval_reference,
    });
  } catch (err) {
    console.error(`[shopify-ops] Failed to record audit timeline entry on ${orderId}:`, err?.message || err);
  }
}

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

const FULFILLMENT_CREATE_MUTATION = `
  mutation FulfillmentCreate($fulfillment: FulfillmentInput!, $message: String) {
    fulfillmentCreate(fulfillment: $fulfillment, message: $message) {
      fulfillment {
        id
        name
        status
        trackingInfo(first: 10) {
          number
          company
          url
        }
      }
      userErrors { field message }
    }
  }
`;

function isTestOrder(order) {
  const haystack = [
    order.order_number,
    order.note,
    ...(order.tags || []),
  ]
    .join(" ")
    .toLowerCase();
  return (
    haystack.includes("test order") ||
    haystack.includes("paintaccess ops test") ||
    haystack.includes("ai agent test") ||
    haystack.includes("do not process") ||
    haystack.includes("do not fulfill") ||
    haystack.includes("do not fulfil")
  );
}

async function completeFulfillment(input = {}) {
  // approval_reference is kept as a free-text audit note (see audit() call below),
  // not as the approval gate itself -- the real gate is the APPROVAL_TAG check
  // right after getOrder(), which only a human in Shopify Admin can satisfy.
  const approvalReference = safeText(input.approval_reference, 200);

  const trackingNumber = safeText(input.tracking_number, 120);
  if (!trackingNumber) {
    const err = new Error("tracking_number is required before completing fulfilment.");
    err.code = "missing_tracking_number";
    err.statusCode = 400;
    throw err;
  }

  const order = await getOrder(input);
  if (!hasApprovalTag(order.tags)) {
    const err = new Error(
      `Order must carry the "${APPROVAL_TAG}" tag before completing fulfilment. Ask Daniel to add it directly in Shopify Admin -- no MCP tool can add this tag.`
    );
    err.code = "approval_required";
    err.statusCode = 400;
    throw err;
  }

  const allowLiveOrder = input.allow_live_order === true;
  if (!allowLiveOrder && !isTestOrder(order)) {
    const err = new Error(
      "Final fulfilment is blocked for non-test orders unless allow_live_order is true and Daniel approval is recorded."
    );
    err.code = "live_order_fulfillment_blocked";
    err.statusCode = 403;
    throw err;
  }

  const readiness = await getFulfillmentReadiness(input);
  const openFulfillmentOrders = readiness.fulfillment_orders.filter((fo) =>
    ["OPEN", "IN_PROGRESS", "SCHEDULED"].includes(String(fo.status || "").toUpperCase())
  );
  if (!openFulfillmentOrders.length) {
    return {
      ok: false,
      order_id: order.id,
      order_number: order.order_number,
      fulfilled: false,
      message: "No open fulfilment order is available to complete.",
      fulfillment_orders: readiness.fulfillment_orders,
    };
  }

  const trackingCompany = safeText(input.tracking_company, 120);
  const trackingUrl = safeText(input.tracking_url, 500);
  const fulfillment = {
    notifyCustomer: input.notify_customer === true,
    lineItemsByFulfillmentOrder: openFulfillmentOrders.map((fo) => ({
      fulfillmentOrderId: fo.id,
    })),
    trackingInfo: {
      number: trackingNumber,
      ...(trackingCompany ? { company: trackingCompany } : {}),
      ...(trackingUrl ? { url: trackingUrl } : {}),
    },
  };

  const data = await shopifyOpsGraphQL(FULFILLMENT_CREATE_MUTATION, {
    fulfillment,
    message: safeText(input.message || `PaintAccess fulfilment completed. Approval: ${approvalReference}`, 500),
  });
  const payload = data.fulfillmentCreate;
  const userErrors = payload?.userErrors || [];
  audit("shopify_complete_fulfillment", input, {
    order_id: order.id,
    order_number: order.order_number,
    fulfillment_id: payload?.fulfillment?.id,
    user_errors: userErrors,
  });

  if (userErrors.length === 0) {
    await clearApprovalTag(order.id);
    await recordGatedActionAudit(order.id, {
      note_type: "fulfilment_completed",
      summary: `Fulfilment completed via PaintAccess Operations MCP (tracking ${trackingNumber}).`,
      approval_reference: approvalReference || "ops-approved tag",
    });
  }

  return {
    ok: userErrors.length === 0,
    order_id: order.id,
    order_number: order.order_number,
    fulfilled: userErrors.length === 0,
    approval_reference: approvalReference,
    notify_customer: fulfillment.notifyCustomer,
    fulfillment: payload?.fulfillment || null,
    user_errors: userErrors,
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
    suggested_timeline_entry: buildOpsTimelineEntry(
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
      "Record the final action in Shopify timeline/tags.",
    ],
  };
}

const ORDER_INVOICE_SEND_MUTATION = `
  mutation OrderInvoiceSend($orderId: ID!, $email: EmailInput) {
    orderInvoiceSend(id: $orderId, email: $email) {
      order { id name }
      userErrors { field message }
    }
  }
`;

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
    tags: order.tags || [],
  };
}

async function sendOrderInvoiceEmailViaShopify(input, prepared, to, subject, body, approvalReference) {
  const email = {
    to,
    subject,
    customMessage: body,
  };

  const data = await shopifyOpsGraphQL(ORDER_INVOICE_SEND_MUTATION, {
    orderId: prepared.order_id,
    email,
  });
  const payload = data.orderInvoiceSend;
  const userErrors = payload?.userErrors || [];

  audit("shopify_send_customer_email", input, {
    order_id: prepared.order_id,
    order_number: prepared.order_number,
    delivery_method: "order_invoice",
    to,
    approval_reference: approvalReference,
    user_errors: userErrors,
  });

  if (userErrors.length === 0) {
    await clearApprovalTag(prepared.order_id);
    await recordGatedActionAudit(prepared.order_id, {
      note_type: "customer_email_sent",
      summary: `Customer email sent via Shopify order invoice to ${to}. Subject: ${subject}.`,
      approval_reference: approvalReference || "ops-approved tag",
    });
  }

  return {
    ok: userErrors.length === 0,
    sent: userErrors.length === 0,
    provider: "shopify_order_invoice",
    native_template: "Order invoice",
    order_id: prepared.order_id,
    order_number: prepared.order_number,
    to,
    subject,
    custom_message: body,
    approval_reference: approvalReference,
    user_errors: userErrors,
  };
}

async function sendDraftOrderInvoiceEmailViaShopify(input, prepared, to, subject, body, approvalReference) {
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
    delivery_method: "draft_order_invoice",
    draft_order_id: draftId,
    to,
    approval_reference: approvalReference,
  });

  await clearApprovalTag(prepared.order_id);
  await recordGatedActionAudit(prepared.order_id, {
    note_type: "customer_email_sent",
    summary: `Customer/supplier email sent via Shopify draft order invoice to ${to}. Subject: ${subject}.`,
    approval_reference: approvalReference || "ops-approved tag",
  });

  return {
    ok: true,
    sent: true,
    provider: "shopify_draft_order_invoice",
    native_template: "Draft order invoice",
    order_id: prepared.order_id,
    order_number: prepared.order_number,
    draft_order_id: draftId,
    to,
    subject,
    custom_message: body,
    approval_reference: approvalReference,
    shopify_response: invoice?.draft_order_invoice ? { invoice_sent: true } : { invoice_sent: true },
  };
}

async function sendCustomerEmailViaShopify(input = {}) {
  // approval_reference is kept as a free-text audit note (see audit() calls in the
  // send* helpers below), not as the approval gate itself -- the real gate is the
  // APPROVAL_TAG check right after prepareCustomerEmail(), below.
  const approvalReference = safeText(input.approval_reference, 200);

  const prepared = await prepareCustomerEmail(input);
  if (!hasApprovalTag(prepared.tags)) {
    const err = new Error(
      `Order must carry the "${APPROVAL_TAG}" tag before sending a customer email through Shopify. Ask Daniel to add it directly in Shopify Admin -- no MCP tool can add this tag.`
    );
    err.code = "approval_required";
    err.statusCode = 400;
    throw err;
  }
  const to = safeEmail(input.to || prepared.customer_email);
  if (!to) {
    const err = new Error("A valid recipient email is required.");
    err.code = "invalid_recipient";
    err.statusCode = 400;
    throw err;
  }

  const subject = safeText(input.subject || prepared.subject, 240);
  const rawBody = safeMultilineText(input.body_text || prepared.body_text, 5000);
  const includePlainSignature = input.include_plain_signature === true;
  const body = includePlainSignature ? rawBody : stripPlainPaintAccessSignature(rawBody);
  const requestedMethod = safeText(input.delivery_method, 80);
  const supplierLike =
    input.recipient_type === "supplier" || input.template_type === "supplier_po";
  const deliveryMethod =
    requestedMethod ||
    (supplierLike ? "draft_order_invoice" : "order_invoice");

  if (deliveryMethod === "draft_order_invoice") {
    return sendDraftOrderInvoiceEmailViaShopify(
      input,
      prepared,
      to,
      subject,
      body,
      approvalReference
    );
  }

  const result = await sendOrderInvoiceEmailViaShopify(
    input,
    prepared,
    to,
    subject,
    body,
    approvalReference
  );

  if (
    result.ok ||
    input.fallback_to_draft_order_invoice !== true
  ) {
    return result;
  }

  const fallback = await sendDraftOrderInvoiceEmailViaShopify(
    { ...input, delivery_method: "draft_order_invoice" },
    prepared,
    to,
    subject,
    body,
    approvalReference
  );

  return {
    ...fallback,
    fallback_from: "shopify_order_invoice",
    order_invoice_user_errors: result.user_errors,
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
  addOrderTimelineEntry,
  addOrderTag,
  completeFulfillment,
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
