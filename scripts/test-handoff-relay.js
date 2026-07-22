/**
 * Offline tests for the relay handoff's pure logic (lib/comms/relay.js):
 * staff-command parsing, target resolution, channel mapping, labels, links.
 *
 * Deliberately NEVER calls openRelay/routeStaffMessage/escalateToHuman — those
 * hit Twilio/Supabase and page Daniel a real SMS (see the testing gotcha in
 * CLAUDE.md project memory). Run: npm run test:handoff-relay
 */
process.env.HANDOFF_STAFF_NAMES = "+61410609617:Daniel, +61400111222:Cris";
process.env.RELAY_IDLE_HOURS = "";

const relay = require("../lib/comms/relay");

let pass = 0;
let fail = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
  } else {
    fail++;
    console.error(`✗ ${label}\n    expected ${e}\n    got      ${a}`);
  }
}

// ---- parseStaffCommand -----------------------------------------------------
const p = relay.parseStaffCommand;
check("done bare", p("#done"), { type: "done", tag: null });
check("done with tag", p("#done 12"), { type: "done", tag: 12 });
check("close with #tag", p("#close #7"), { type: "done", tag: 7 });
check("done case-insensitive", p("#DONE"), { type: "done", tag: null });
check("link bare", p("#link"), { type: "link", tag: null });
check("link with tag", p("#link 3"), { type: "link", tag: 3 });
check("tagged message", p("#12 We'll ship a replacement today"), {
  type: "message",
  tag: 12,
  body: "We'll ship a replacement today",
});
check("tagged multiline", p("#5 line one\nline two"), { type: "message", tag: 5, body: "line one\nline two" });
check("plain message", p("On it, give me 10 minutes"), {
  type: "message",
  tag: null,
  body: "On it, give me 10 minutes",
});
// "#done extra words" is NOT a close command (too easy to lose a real reply that
// happens to start with #done) — it relays as a plain message.
check("done with trailing text is a message", p("#done and tell them thanks").type, "message");
check("hash without digits is plain", p("#urgent please call"), {
  type: "message",
  tag: null,
  body: "#urgent please call",
});

// ---- resolveTarget ---------------------------------------------------------
const r12 = { id: "aaa", tag: 12, customer_name: "John" };
const r14 = { id: "bbb", tag: 14, customer_name: "Maria" };
const rt = relay.resolveTarget;
check("tag match", rt({ tag: 12, quotedRelayId: null, relays: [r12, r14] }).relay.id, "aaa");
check("tag string/number tolerant", rt({ tag: "14", quotedRelayId: null, relays: [r12, r14] }).relay.id, "bbb");
check("unknown tag", rt({ tag: 99, quotedRelayId: null, relays: [r12, r14] }).error, "unknown_tag");
check("quoted match", rt({ tag: null, quotedRelayId: "bbb", relays: [r12, r14] }).relay.id, "bbb");
check("quoted but closed", rt({ tag: null, quotedRelayId: "zzz", relays: [r12, r14] }).error, "closed");
check("single active", rt({ tag: null, quotedRelayId: null, relays: [r12] }).relay.id, "aaa");
check("none active", rt({ tag: null, quotedRelayId: null, relays: [] }).error, "none");
check("ambiguous", rt({ tag: null, quotedRelayId: null, relays: [r12, r14] }).error, "ambiguous");
check("tag beats quote", rt({ tag: 12, quotedRelayId: "bbb", relays: [r12, r14] }).relay.id, "aaa");

// ---- customerChannelFor ----------------------------------------------------
const cc = relay.customerChannelFor;
check("whatsapp stays whatsapp", cc("whatsapp"), "whatsapp");
check("WhatsApp case-insensitive", cc("WhatsApp"), "whatsapp");
check("sms is sms", cc("sms"), "sms");
check("voice goes sms", cc("voice"), "sms");
check("chat goes sms", cc("chat"), "sms");
check("empty goes sms", cc(""), "sms");

// ---- staffLabel ------------------------------------------------------------
check("named staff", relay.staffLabel("+61410609617"), "Daniel");
check("named staff with spaces in env", relay.staffLabel("+61400111222"), "Cris");
check("unknown staff falls back to digits", relay.staffLabel("+61499999999"), "staff ..9999");

// ---- relayEnabled / adminThreadLink ---------------------------------------
process.env.HANDOFF_METHOD = "";
check("flag unset = link mode", relay.relayEnabled(), false);
process.env.HANDOFF_METHOD = "relay";
check("flag relay", relay.relayEnabled(), true);
process.env.HANDOFF_METHOD = "RELAY ";
check("flag tolerant of case/space", relay.relayEnabled(), true);
process.env.HANDOFF_METHOD = "link";
check("flag link", relay.relayEnabled(), false);

process.env.ADMIN_DEEP_LINK_BASE = "";
process.env.PUBLIC_BASE_URL = "https://ai-agent-front-back.vercel.app";
check("no admin base → no link", relay.adminThreadLink("123e4567-e89b-12d3-a456-426614174000"), null);
process.env.ADMIN_DEEP_LINK_BASE = "https://admin.shopify.com/store/zgmzge-0d/apps/paintaccess";
check(
  "short link built from PUBLIC_BASE_URL",
  relay.adminThreadLink("123e4567-e89b-12d3-a456-426614174000"),
  "https://ai-agent-front-back.vercel.app/t/123e4567-e89b-12d3-a456-426614174000"
);
check("no thread → no link", relay.adminThreadLink(""), null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
