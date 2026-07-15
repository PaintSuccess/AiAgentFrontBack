const assert = require("node:assert/strict");
const fs = require("node:fs");

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

const {
  agentAskedForOrderDetails,
  extractEmail,
  extractOrderNumber,
  formatOrderReply,
  formatRecentOrdersReply,
  hasExplicitOrderReference,
  looksLikeOrderIntent,
  lookupCustomerOrder,
  normalizeOrderNumber,
} = require("../lib/customer-order-lookup");
const { shopifyFetch } = require("../lib/shopify");

function sampleOrder(overrides = {}) {
  return {
    name: "#44542",
    created_at: "2026-07-06T10:00:00+10:00",
    financial_status: "paid",
    fulfillment_status: "fulfilled",
    total_price: "123.45",
    currency: "AUD",
    line_items: [{ title: "Oval Cutter Paint Brush", quantity: 1, price: "12.30" }],
    fulfillments: [
      {
        status: "success",
        tracking_company: "Australia Post",
        tracking_number: "PA123",
        tracking_url: "https://auspost.example/PA123",
      },
    ],
    ...overrides,
  };
}

async function runUnitTests() {
  assert.equal(normalizeOrderNumber("#44542"), "#44542");
  assert.equal(normalizeOrderNumber("order 44542 please"), "#44542");
  assert.equal(extractOrderNumber("gluked@gmail.com\n#44542"), "#44542");
  assert.equal(extractEmail("please check GLUKED@gmail.com #44542"), "gluked@gmail.com");
  assert.equal(looksLikeOrderIntent("Can you check my orders by this phone?"), true);
  assert.equal(looksLikeOrderIntent("I need an oval brush"), false);

  // A generic logistics question is not an order-status request. Live bug: "do you
  // ship to South Africa?" was answered with "send your order number and email".
  assert.equal(
    looksLikeOrderIntent("Hi Paint Access, do you ship to South Africa? What method of shipping do you use"),
    false
  );

  // Numeric model names must never read as order references. Live bug: a customer
  // asking to book a service for a "graco 650 pc pro ultra max" was told
  // "I couldn't find order #650."
  for (const modelText of [
    "Hi, I would like to book in a heavy duty service for a graco 650 pc pro ultra max.",
    "do you have the graco 495 in stock",
    "I need a GH 200 sprayer",
    "Uni-Pro 230 roller kit price?",
  ]) {
    assert.equal(looksLikeOrderIntent(modelText), false, `model text read as order intent: ${modelText}`);
    assert.equal(hasExplicitOrderReference(modelText), false, `model text read as order ref: ${modelText}`);
  }

  // A phone number is far too long to be one of this store's order numbers.
  // (ACMA numbers reserved for fiction — this repo is public, so never use a real
  // customer's number as a fixture.)
  assert.equal(extractOrderNumber("61491570156"), "");
  assert.equal(extractOrderNumber("+61491570157"), "");

  // "#" is what marks a number as an order reference on sight.
  assert.equal(hasExplicitOrderReference("Order number #44550"), true);
  assert.equal(hasExplicitOrderReference("#44550"), true);
  assert.equal(hasExplicitOrderReference("44550"), false);

  // A bare number only counts as an order number when we just asked for one.
  const askedHistory = [
    { role: "agent", text: "For security, please send your order number and the email used for that order." },
  ];
  const chitchatHistory = [{ role: "agent", text: "No worries! What are you after today?" }];
  assert.equal(agentAskedForOrderDetails(askedHistory), true);
  assert.equal(agentAskedForOrderDetails(chitchatHistory), false);
  assert.equal(agentAskedForOrderDetails([]), false);

  const reply = formatOrderReply(sampleOrder());
  assert.match(reply, /#44542/);
  assert.match(reply, /payment paid/);
  assert.match(reply, /fulfilment fulfilled/);
  assert.match(reply, /Oval Cutter Paint Brush x1/);
  assert.match(reply, /Australia Post PA123/);
  assert.doesNotMatch(reply, /address|payment details|internal/i);

  const recent = formatRecentOrdersReply([
    sampleOrder(),
    sampleOrder({ name: "#44543", fulfillment_status: null }),
  ]);
  assert.match(recent, /#44542/);
  assert.match(recent, /#44543/);
  assert.match(recent, /Tell me the order number/);
}

async function runOptionalLiveTest() {
  const orderNumber = process.env.TEST_ORDER_NUMBER;
  const email = process.env.TEST_ORDER_EMAIL;
  if (!orderNumber || !email) return;

  const result = await lookupCustomerOrder({ orderNumber, email });
  assert.equal(result.found, true);
  assert.ok(result.orders?.[0]?.order_number);
  assert.ok(result.message.includes(result.orders[0].order_number));

  const clean = normalizeOrderNumber(orderNumber).replace(/^#/, "");
  const data = await shopifyFetch(`orders.json?name=%23${encodeURIComponent(clean)}&status=any&limit=1`);
  const customerId = data.orders?.[0]?.customer?.id;
  if (customerId) {
    const recent = await lookupCustomerOrder({ customerId: String(customerId) });
    assert.equal(recent.found, true);
    assert.match(recent.message, /recent orders/i);
  }
}

runUnitTests()
  .then(runOptionalLiveTest)
  .then(() => {
    console.log("Text channel order tests passed");
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
