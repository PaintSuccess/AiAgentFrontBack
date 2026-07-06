const { shopifyFetch } = require("./shopify");

function normalizePhone(phone) {
  const raw = String(phone || "").trim();
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (raw.startsWith("+")) return `+${digits}`;
  if (digits.startsWith("61")) return `+${digits}`;
  if (digits.startsWith("0")) return `+61${digits.slice(1)}`;
  if (digits.length === 9) return `+61${digits}`;
  return `+${digits}`;
}

function phoneSearchVariants(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return [];

  const digits = normalized.replace(/\D/g, "");
  const variants = new Set([normalized, digits]);
  if (digits.startsWith("61")) {
    const local = `0${digits.slice(2)}`;
    variants.add(local);
    variants.add(local.replace(/(\d{2})(\d{4})(\d{4})/, "$1 $2 $3"));
    variants.add(local.replace(/(\d{4})(\d{3})(\d{3})/, "$1 $2 $3"));
  }
  return [...variants].filter(Boolean);
}

function customerName(customer) {
  return [customer?.first_name, customer?.last_name].filter(Boolean).join(" ").trim();
}

function firstName(customer) {
  return String(customer?.first_name || customerName(customer).split(/\s+/)[0] || "").trim();
}

function safeTags(tags) {
  return String(tags || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 8)
    .join(", ");
}

function formatDate(isoDate) {
  if (!isoDate) return "";
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Australia/Sydney",
  });
}

function summarizeOrder(order) {
  const status = [
    order.financial_status ? `payment ${order.financial_status}` : null,
    order.fulfillment_status ? `fulfillment ${order.fulfillment_status}` : "fulfillment unfulfilled",
  ].filter(Boolean).join(", ");
  const items = (order.line_items || [])
    .slice(0, 3)
    .map((item) => `${item.title} x${item.quantity}`)
    .join("; ");
  return [
    order.name,
    formatDate(order.created_at),
    status,
    order.total_price ? `${order.total_price} ${order.currency || "AUD"}` : null,
    items ? `items: ${items}` : null,
  ].filter(Boolean).join(" | ");
}

function summarizeOrders(orders) {
  if (!orders.length) return "";
  return orders.map(summarizeOrder).join(" || ");
}

async function findCustomerByPhone(phone) {
  for (const variant of phoneSearchVariants(phone)) {
    const data = await shopifyFetch(
      `customers/search.json?query=phone:${encodeURIComponent(variant)}&limit=3`
    );
    const customer = (data.customers || [])[0];
    if (customer) return customer;
  }
  return null;
}

async function getRecentOrdersForCustomer(customerId, limit = 3) {
  if (!customerId) return [];
  const data = await shopifyFetch(
    `orders.json?customer_id=${encodeURIComponent(customerId)}&status=any&limit=${limit}&order=created_at%20desc&fields=id,name,created_at,financial_status,fulfillment_status,total_price,currency,line_items,fulfillments`
  );
  return data.orders || [];
}

async function getCustomerContextByPhone(phone) {
  const normalizedPhone = normalizePhone(phone);
  const customer = await findCustomerByPhone(normalizedPhone);
  if (!customer) {
    return {
      found: false,
      customer_phone: normalizedPhone,
      dynamicVariables: baseDynamicVariables({ customer_phone: normalizedPhone }),
    };
  }

  const orders = await getRecentOrdersForCustomer(customer.id);
  const recentOrders = summarizeOrders(orders);
  const name = customerName(customer);
  const givenName = firstName(customer);
  const tags = safeTags(customer.tags);
  const summary = [
    name ? `Recognized Shopify customer: ${name}.` : "Recognized Shopify customer.",
    recentOrders ? `Recent orders: ${recentOrders}` : "No recent order summary available.",
    tags ? `Customer tags: ${tags}.` : null,
  ].filter(Boolean).join(" ");

  return {
    found: true,
    customer,
    recentOrders: orders,
    customer_name: name,
    customer_first_name: givenName,
    customer_email: customer.email || "",
    customer_id: String(customer.id || ""),
    customer_phone: normalizedPhone || customer.phone || "",
    customer_tags: tags,
    customer_recent_orders: recentOrders,
    customer_context_summary: summary,
    dynamicVariables: baseDynamicVariables({
      customer_name: name,
      customer_greeting: givenName ? ` ${givenName}` : "",
      customer_email: customer.email || "",
      customer_id: String(customer.id || ""),
      customer_phone: normalizedPhone || customer.phone || "",
      customer_tags: tags,
      customer_recent_orders: recentOrders,
      customer_context_summary: summary,
    }),
  };
}

function baseDynamicVariables(values = {}) {
  return {
    channel: values.channel || "phone",
    conversation_mode: values.conversation_mode || "voice",
    ui_surface: values.ui_surface || values.channel || "phone",
    display_products_available: values.display_products_available || "false",
    customer_name: values.customer_name || "",
    customer_greeting: values.customer_greeting || "",
    customer_email: values.customer_email || "",
    customer_id: values.customer_id || "",
    customer_phone: values.customer_phone || "",
    customer_tags: values.customer_tags || "",
    customer_recent_orders: values.customer_recent_orders || "",
    customer_context_summary: values.customer_context_summary || "",
  };
}

module.exports = {
  normalizePhone,
  phoneSearchVariants,
  getRecentOrdersForCustomer,
  getCustomerContextByPhone,
  baseDynamicVariables,
};
