const fs = require("node:fs");
const assert = require("node:assert/strict");

function loadDotEnv(path = ".env") {
  if (!fs.existsSync(path)) return;
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

loadDotEnv();

const { askElevenLabsTextAgent } = require("../lib/elevenlabs-text");
const { shopifyFetch } = require("../lib/shopify");
const { getCustomerContextByPhone } = require("../lib/shopify-customer-context");
const { normalizeOrderNumber } = require("../lib/customer-order-lookup");

function expectReply(name, reply, checks) {
  const failures = checks
    .filter((check) => !check.test(reply))
    .map((check) => check.label);

  if (failures.length) {
    console.error(`\n${name} failed: ${failures.join(", ")}`);
    console.error(reply);
  }

  assert.deepEqual(failures, []);
}

async function customerContextFromTestOrder() {
  const orderNumber = process.env.TEST_ORDER_NUMBER || "#44542";
  const clean = normalizeOrderNumber(orderNumber).replace(/^#/, "");
  const data = await shopifyFetch(`orders.json?name=%23${encodeURIComponent(clean)}&status=any&limit=1`);
  const order = data.orders?.[0];
  if (!order) return null;

  const phone =
    order.phone ||
    order.customer?.phone ||
    order.shipping_address?.phone ||
    order.billing_address?.phone ||
    "";
  if (!phone) return null;

  return getCustomerContextByPhone(phone);
}

async function run() {
  const customerContext = await customerContextFromTestOrder();
  const base = {
    channel: "whatsapp",
    customerPhone: customerContext?.customer_phone || "+61400000000",
    customerName: customerContext?.customer_name || "Test Customer",
    customerEmail: customerContext?.customer_email || process.env.TEST_ORDER_EMAIL || "",
    customerContextSummary: customerContext?.customer_context_summary || "",
    customerId: customerContext?.customer_id || "",
    customerTags: customerContext?.customer_tags || "",
    customerRecentOrders: customerContext?.customer_recent_orders || "",
    customerOrders: customerContext?.recentOrders || [],
    timeoutMs: 25000,
  };

  const greeting = await askElevenLabsTextAgent({
    ...base,
    text: "Hi Paint Access, I need help from the WhatsApp support chat.",
    conversationHistory: [],
  });
  expectReply("greeting", greeting, [
    { label: "does not product-dump", test: (r) => !/I found these options/i.test(r) },
    { label: "has helpful greeting", test: (r) => /help|what|looking|need|happy|g'day|hi/i.test(r) },
    { label: "does not include product URL", test: (r) => !/https?:\/\//i.test(r) },
  ]);

  const compound = await askElevenLabsTextAgent({
    ...base,
    text: "I am interested in Dan's sprayers. Also suggest an oval cutter paint brush I could buy.",
    conversationHistory: [],
  });
  expectReply("compound product request", compound, [
    { label: "includes Dan sprayer", test: (r) => /Dan.?s|sprayer|airless/i.test(r) },
    { label: "includes brush", test: (r) => /brush|oval|cutter/i.test(r) },
    { label: "includes product links", test: (r) => (r.match(/https:\/\/www\.paintaccess\.com\.au\/products\//g) || []).length >= 2 },
    { label: "does not mention website UI", test: (r) => !/screen|card|popup|displayed/i.test(r) },
  ]);

  const brushFollowup = await askElevenLabsTextAgent({
    ...base,
    text: "What about brushes I asked?",
    conversationHistory: [
      { role: "customer", channel: "whatsapp", text: "I am interested in Dan's sprayers. Also suggest an oval cutter paint brush I could buy." },
      { role: "agent", channel: "whatsapp", text: compound },
    ],
  });
  expectReply("brush follow-up", brushFollowup, [
    { label: "answers with brushes", test: (r) => /brush|oval|cutter/i.test(r) },
    { label: "includes product link", test: (r) => /https:\/\/www\.paintaccess\.com\.au\/products\//i.test(r) },
  ]);

  if (customerContext?.customer_id) {
    const recentOrders = await askElevenLabsTextAgent({
      ...base,
      text: "Can you check my orders by the phone number I am messaging from?",
      conversationHistory: [],
    });
    expectReply("phone-verified order lookup", recentOrders, [
      { label: "mentions order context", test: (r) => /recent orders|#\d+|order/i.test(r) },
      { label: "does not demand email first", test: (r) => !/email.*order|order.*email/i.test(r) },
    ]);
  }

  const guestOrder = await askElevenLabsTextAgent({
    text: "Can you check my order?",
    channel: "whatsapp",
    customerPhone: "+61400000000",
    conversationHistory: [],
    timeoutMs: 25000,
  });
  expectReply("guest order verification", guestOrder, [
    { label: "asks for order number", test: (r) => /order number/i.test(r) },
    { label: "asks for email", test: (r) => /email/i.test(r) },
  ]);

  console.log("Text channel agent QA passed");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
