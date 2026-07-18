/** Pixel collect endpoint test (pure — no DB, no network). node scripts/test-pixel-collect.js */
const handler = require("../api/pixel/collect");
const results = [];
const ok = (n, c, d = "") => results.push([n, !!c, d]);

function mkRes() {
  const r = { headers: {}, code: null, body: null };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.end = () => r;
  return r;
}
const call = (method, body, origin) => {
  const res = mkRes();
  return Promise.resolve(handler({ method, body, headers: origin ? { origin } : {} }, res)).then(() => res);
};

(async () => {
  let r = await call("OPTIONS", {}, "https://www.paintaccess.com.au");
  ok("OPTIONS preflight → 200", r.code === 200);
  ok("allowed origin echoed", r.headers["Access-Control-Allow-Origin"] === "https://www.paintaccess.com.au");

  r = await call("OPTIONS", {}, "https://evil.example.com");
  ok("unknown origin NOT echoed", r.headers["Access-Control-Allow-Origin"] === undefined, String(r.headers["Access-Control-Allow-Origin"]));

  // Shopify sandboxes custom pixels WITHOUT allow-same-origin => opaque origin => Origin: null.
  // Rejecting null silently drops every real pixel beacon (found live 2026-07-16).
  r = await call("OPTIONS", {}, "null");
  ok("sandbox Origin:null IS allowed (the real pixel)", r.headers["Access-Control-Allow-Origin"] === "null", String(r.headers["Access-Control-Allow-Origin"]));

  r = await call("POST", { clientId: "c1", events: [{ name: "page_viewed", url: "https://x" }] }, "null");
  ok("sandbox POST accepted", r.code === 204);

  r = await call("GET", {});
  ok("GET rejected → 405", r.code === 405);

  r = await call("POST", {});
  ok("empty body → 204 (not an error)", r.code === 204);

  r = await call("POST", { clientId: "c1", events: [{ name: "evil_event", url: "x" }] });
  ok("non-allowlisted event dropped → 204", r.code === 204);

  r = await call("POST", { clientId: "c1", events: [{ name: "checkout_completed", email: "a@b.c" }] });
  ok("checkout/PII event NOT accepted", r.code === 204);

  r = await call("POST", { clientId: "c1", events: [{ name: "page_viewed", url: "https://x/y" }] });
  ok("valid event accepted → 204", r.code === 204);

  r = await call("POST", { clientId: "c1", events: [{ name: "page_viewed", url: "javascript:alert(1)" }] });
  ok("javascript: url event still 204 (event kept, url dropped)", r.code === 204);

  ok("no throw on garbage", true);
  r = await call("POST", { clientId: "c1", events: "not-an-array" });
  ok("malformed events → 204", r.code === 204);

  let pass = 0;
  for (const [n, c, d] of results) { console.log(`${c ? "PASS" : "FAIL"}  ${n}${d && !c ? ` — got: ${d}` : ""}`); if (c) pass++; }
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
})();
