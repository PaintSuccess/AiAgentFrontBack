function buildOrderEmailTemplate({ order, template_type, recipient_type, custom_message, supplier } = {}) {
  const type = String(template_type || "order_processing");
  const orderNumber = order?.order_number || order?.name || "";
  const customerName = order?.customer_name || order?.shipping_address?.name || "there";
  const items = formatItems(order?.line_items || []);
  const signature = "Kind regards,\nPaintAccess Team";

  if (type === "supplier_po") {
    const supplierName = supplier || "Supplier";
    return {
      subject: `Purchase Order ${orderNumber} - PaintAccess`,
      body_text: [
        `Hi ${supplierName},`,
        "",
        "Please process the following PaintAccess order:",
        "",
        `Order: ${orderNumber}`,
        items,
        formatShipping(order),
        "",
        custom_message || "Please confirm availability, total cost, and tracking details when dispatched.",
        "",
        signature,
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  if (type === "stock_delay") {
    return {
      subject: `Update on your PaintAccess order ${orderNumber}`,
      body_text: [
        `Hi ${customerName},`,
        "",
        `Thanks for your order ${orderNumber}. We are currently processing it, and one or more items may require extra supplier handling before dispatch.`,
        "",
        custom_message || "We will keep you updated as soon as we have the next confirmed status.",
        "",
        "Order details:",
        items,
        "",
        signature,
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  if (type === "tracking_update") {
    return {
      subject: `Tracking update for your PaintAccess order ${orderNumber}`,
      body_text: [
        `Hi ${customerName},`,
        "",
        `We have an update for your order ${orderNumber}.`,
        "",
        custom_message || "Your tracking details are being prepared and will be shared as soon as they are confirmed.",
        "",
        signature,
      ].join("\n"),
    };
  }

  if (type === "cancellation_reply") {
    return {
      subject: `Your PaintAccess order ${orderNumber}`,
      body_text: [
        `Hi ${customerName},`,
        "",
        custom_message || `We have received your request about order ${orderNumber}. Our team will review the order status and confirm the next step shortly.`,
        "",
        signature,
      ].join("\n"),
    };
  }

  return {
    subject: `Your PaintAccess order ${orderNumber}`,
    body_text: [
      `Hi ${customerName},`,
      "",
      custom_message || `Your order ${orderNumber} is processing.`,
      "",
      "Order details:",
      items,
      recipient_type === "supplier" ? formatShipping(order) : "",
      "",
      signature,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

function formatItems(items) {
  if (!items.length) return "Items: not available";
  return items
    .map((item) => {
      const sku = item.sku ? ` (${item.sku})` : "";
      const qty = item.quantity || item.remaining_quantity || 1;
      return `- ${item.title || item.product_title || "Item"}${sku} x ${qty}`;
    })
    .join("\n");
}

function formatShipping(order) {
  const address = order?.shipping_address;
  if (!address) return "";
  const lines = [
    address.name,
    address.company,
    address.address1,
    address.address2,
    [address.city, address.province, address.zip].filter(Boolean).join(" "),
    address.country,
    address.phone ? `Phone: ${address.phone}` : "",
  ].filter(Boolean);
  return `Ship to:\n${lines.join("\n")}`;
}

module.exports = {
  buildOrderEmailTemplate,
};
