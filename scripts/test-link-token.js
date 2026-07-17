/** Signed link-token test (pure — no DB, no network). node scripts/test-link-token.js */
process.env.API_SECRET_TOKEN = process.env.API_SECRET_TOKEN || "test-secret-for-link-token";
const lt = require("../lib/comms/link-token");

const results = [];
const ok = (n, c, d = "") => results.push([n, !!c, d]);
const CID = "3f1a2b4c-5d6e-4f70-8192-a3b4c5d6e7f8";

// --- sign / verify roundtrip
const t = lt.signContactToken(CID);
ok("token is produced", !!t, String(t));
ok("token is short enough for a WhatsApp message", t && t.length <= 44, `len=${t && t.length}`);
ok("roundtrips to the same contact", lt.verifyContactToken(t) === CID, String(lt.verifyContactToken(t)));

// --- forgery
ok("garbage rejected", lt.verifyContactToken("not-a-token") === null);
ok("empty rejected", lt.verifyContactToken("") === null);
const tampered = t.slice(0, -2) + (t.slice(-2) === "AA" ? "BB" : "AA");
ok("tampered MAC rejected", lt.verifyContactToken(tampered) === null, String(lt.verifyContactToken(tampered)));
// flip a byte in the contact id itself, keep the MAC
const raw = Buffer.from(t.replace(/-/g,"+").replace(/_/g,"/"), "base64");
raw[0] ^= 0xff;
const swapped = raw.toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
ok("swapped contact id rejected (MAC covers it)", lt.verifyContactToken(swapped) === null);

// --- expiry
const expired = lt.signContactToken(CID, { ttlDays: -1 });
ok("expired token rejected", lt.verifyContactToken(expired) === null);

// --- bad input
ok("non-uuid contact refuses to sign", lt.signContactToken("nope") === null);

// --- link tagging: only OUR storefront
const body = "Here you go: https://www.paintaccess.com.au/products/sprayer and https://paintaccess.com.au/cart";
const tagged = lt.tagLinks(body, CID);
ok("storefront links tagged", (tagged.match(/[?&]pa=/g) || []).length === 2, tagged);
ok("tagged link still resolves to contact", lt.contactIdFromUrl(tagged.split(" ")[3]) === CID);

const foreign = "Chat to us: https://wa.me/61400000000?text=hi and see https://evil.example.com/x";
const taggedForeign = lt.tagLinks(foreign, CID);
ok("wa.me NOT tagged (would leak identity to a third party)", !/wa\.me[^\s]*pa=/.test(taggedForeign), taggedForeign);
ok("third-party domain NOT tagged", !/evil\.example\.com[^\s]*pa=/.test(taggedForeign), taggedForeign);

const already = lt.tagLinks("https://paintaccess.com.au/x?pa=existing", CID);
ok("already-tagged link left alone", already.includes("pa=existing") && (already.match(/pa=/g)||[]).length === 1, already);

// Trailing sentence punctuation must not be pulled into the path (would corrupt the link).
const dot = lt.tagLinks("See https://www.paintaccess.com.au/products/sprayer.", CID);
ok("trailing period not in path", /\/products\/sprayer\?pa=/.test(dot) && dot.trimEnd().endsWith("."), dot);
ok("period-tagged link still resolves", lt.contactIdFromUrl(dot.match(/https:\S+?(?=\.?$)/)[0].replace(/\.$/, "")) === CID);
const comma = lt.tagLinks("Options: https://paintaccess.com.au/cart, or reply.", CID);
ok("trailing comma not in path", /\/cart\?pa=/.test(comma) && /,\s/.test(comma), comma);

ok("body without links untouched", lt.tagLinks("no links here", CID) === "no links here");
ok("empty body safe", lt.tagLinks("", CID) === "");
ok("null contact = no tagging", lt.tagLinks(body, null) === body);

// --- url extraction
ok("untagged url yields no contact", lt.contactIdFromUrl("https://paintaccess.com.au/x") === null);
ok("malformed url yields no contact", lt.contactIdFromUrl("::::") === null);
ok("forged token in url yields no contact", lt.contactIdFromUrl("https://paintaccess.com.au/x?pa=abc") === null);

let pass = 0;
for (const [n, c, d] of results) { console.log(`${c ? "PASS" : "FAIL"}  ${n}${d && !c ? ` — got: ${String(d).slice(0,90)}` : ""}`); if (c) pass++; }
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
