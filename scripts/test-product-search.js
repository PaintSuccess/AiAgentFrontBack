#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_BASE_URL = "https://ai-agent-front-back.vercel.app";

function loadEnv(file) {
  if (!fs.existsSync(file)) return;

  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    if (process.env[match[1]]) continue;

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

loadEnv(path.join(ROOT, ".env"));

const BASE_URL = process.env.PRODUCT_SEARCH_BASE_URL || process.argv[2] || DEFAULT_BASE_URL;
const TOKEN = process.env.API_SECRET_TOKEN;
const USE_LOCAL_HANDLER = BASE_URL === "local" || process.argv.includes("--local");

const CASES = [
  {
    query: "Mirka deros 175mm",
    topHandle: "mirka-deros-ii-750an-175mm-cordless-random-orbital-sander-5-0mm-orbit",
  },
  {
    query: "Mirka 175mm deros",
    topHandle: "mirka-deros-ii-750an-175mm-cordless-random-orbital-sander-5-0mm-orbit",
  },
  {
    query: "175 deros",
    topHandle: "mirka-deros-ii-750an-175mm-cordless-random-orbital-sander-5-0mm-orbit",
  },
  {
    query: "Rust-Oleum Tub Tile Refinishing Kit",
    topHandle: "rust-oleum-tub-tile-refinishing-kit",
  },
  {
    query: "Rustoleum tube and tile refining kit",
    topHandle: "rust-oleum-tub-tile-refinishing-kit",
  },
  {
    query: "Mirka round kit",
    topHandle: "mirka-roundy-kit",
  },
  {
    query: "Mirka Rounding Kit",
    topHandle: "mirka-roundy-kit",
  },
  {
    query: "Mirka Rangy kit",
    top3Handle: "mirka-roundy-kit",
  },
  {
    query: "graco x7 paint sprayer",
    top3Any: ["graco-magnum-x7", "magnum-x7", "graco-x7"],
  },
  {
    query: "zipwall dust barrier",
    top3Any: ["zipwall"],
  },
  {
    query: "masking tape",
    minResults: 3,
  },
  {
    query: "paint sprayer",
    minResults: 3,
  },
];

function productHandle(product) {
  const url = product.url || "";
  const match = url.match(/\/products\/([^/?#]+)/);
  return match ? match[1] : "";
}

function includesNeedle(value, needle) {
  return String(value || "").toLowerCase().includes(String(needle || "").toLowerCase());
}

async function search(query) {
  if (!TOKEN) throw new Error("Missing API_SECRET_TOKEN in environment or .env");

  if (USE_LOCAL_HANDLER) {
    const handler = require(path.join(ROOT, "api/shopify/products"));
    return new Promise((resolve) => {
      const req = {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}` },
        body: { query },
        socket: { remoteAddress: `test-${Math.random()}` },
      };
      const res = {
        code: 200,
        headers: {},
        setHeader(key, value) {
          this.headers[key] = value;
        },
        status(code) {
          this.code = code;
          return this;
        },
        json(value) {
          resolve({ status: this.code, json: value });
        },
        end() {
          resolve({ status: this.code, json: null });
        },
      };

      Promise.resolve(handler(req, res)).catch((error) => {
        resolve({ status: 500, json: { error: error.message } });
      });
    });
  }

  const response = await fetch(`${BASE_URL.replace(/\/$/, "")}/api/shopify/products`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({ query }),
  });

  const json = await response.json().catch(async () => ({
    error: await response.text(),
  }));

  return { status: response.status, json };
}

function validate(test, products) {
  const handles = products.map(productHandle);
  const names = products.map((p) => p.name || p.title || "");
  const top = handles[0] || "";
  const top3 = handles.slice(0, 3);

  if (test.minResults && products.length < test.minResults) {
    return `expected at least ${test.minResults} results, got ${products.length}`;
  }

  if (test.topHandle && top !== test.topHandle) {
    return `expected top handle ${test.topHandle}, got ${top || "(none)"}`;
  }

  if (test.top3Handle && !top3.includes(test.top3Handle)) {
    return `expected ${test.top3Handle} in top 3, got ${top3.join(", ") || "(none)"}`;
  }

  if (test.top3Any) {
    const haystack = top3.concat(names.slice(0, 3)).join(" ");
    if (!test.top3Any.some((needle) => includesNeedle(haystack, needle))) {
      return `expected top 3 to include one of ${test.top3Any.join(", ")}, got ${top3.join(", ") || "(none)"}`;
    }
  }

  return "";
}

async function main() {
  console.log(`Product search regression test`);
  console.log(USE_LOCAL_HANDLER ? "Endpoint: local handler\n" : `Endpoint: ${BASE_URL}\n`);

  let failures = 0;

  for (const test of CASES) {
    const { status, json } = await search(test.query);
    const products = Array.isArray(json.products) ? json.products : [];
    const error = status !== 200
      ? `HTTP ${status}: ${JSON.stringify(json).slice(0, 180)}`
      : validate(test, products);

    const top = products[0];
    const topLine = top ? `${top.name} (${productHandle(top)})` : "(no results)";

    if (error) {
      failures += 1;
      console.log(`FAIL ${test.query}`);
      console.log(`  ${error}`);
      console.log(`  top: ${topLine}`);
    } else {
      console.log(`PASS ${test.query}`);
      console.log(`  top: ${topLine}`);
    }
  }

  console.log(`\n${CASES.length - failures}/${CASES.length} passed`);
  if (failures) process.exit(1);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
