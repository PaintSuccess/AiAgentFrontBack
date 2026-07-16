/**
 * Click-to-WhatsApp referral parsing test (pure — no DB, no network).
 *
 * Guards the silent-failure mode this feature is most exposed to: Meta sends the
 * referral exactly once, on the ad-click message, so a wrong param name captures
 * nothing forever and looks completely healthy while doing it.
 */
const { parseWhatsAppInbound } = require("../lib/whatsapp");

const results = [];
const ok = (n, c, d = "") => results.push([n, !!c, d]);

// Real Twilio CTWA shape: flat `Referral*` params alongside the normal message.
const twilioCtwa = {
  body: {
    From: "whatsapp:+61400000001",
    To: "whatsapp:+61400999999",
    Body: "Hi, saw your ad about the backpack sprayer",
    MessageSid: "SM_ctwa_1",
    ProfileName: "Ad Clicker",
    ReferralCtwaClid: "ARAbc123ClickId",
    ReferralSourceId: "120210000000000001",
    ReferralSourceType: "ad",
    ReferralSourceUrl: "https://fb.me/paintaccess-ad",
    ReferralHeadline: "DAN'S Airless Backpack — 20% off",
    ReferralBody: "Free delivery Australia-wide",
    ReferralMediaId: "media-123",
    ReferralMediaContentType: "image/jpeg",
    ReferralMediaUrl: "https://cdn.example/ad.jpg",
  },
};

// Plain (non-ad) Twilio message — must NOT invent a referral.
const twilioPlain = {
  body: {
    From: "whatsapp:+61400000002",
    Body: "Do you stock 5L primer?",
    MessageSid: "SM_plain_1",
  },
};

// Meta Cloud API shape: referral nested on the message.
const metaCtwa = {
  body: {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: "PN1" },
              contacts: [{ wa_id: "61400000003", profile: { name: "IG Clicker" } }],
              messages: [
                {
                  from: "61400000003",
                  id: "wamid.META1",
                  type: "text",
                  text: { body: "Is this in stock?" },
                  referral: {
                    source_url: "https://fb.me/meta-ad",
                    source_id: "120210000000000002",
                    source_type: "ad",
                    headline: "Spray kits from $199",
                    body: "Shop now",
                    media_type: "video",
                    video_url: "https://cdn.example/ad.mp4",
                    ctwa_clid: "ARMetaClickId",
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  },
};

const t = parseWhatsAppInbound(twilioCtwa);
ok("twilio: message still parses", t && t.from === "+61400000001", t?.from);
ok("twilio: ctwa_clid captured", t?.referral?.ctwa_clid === "ARAbc123ClickId", JSON.stringify(t?.referral?.ctwa_clid));
ok("twilio: ad id captured", t?.referral?.source_id === "120210000000000001");
ok("twilio: source_type captured", t?.referral?.source_type === "ad");
ok("twilio: source_url captured", t?.referral?.source_url === "https://fb.me/paintaccess-ad");
ok("twilio: headline captured", t?.referral?.headline === "DAN'S Airless Backpack — 20% off");
ok("twilio: ad body captured", t?.referral?.body === "Free delivery Australia-wide");
ok("twilio: media fields captured", t?.referral?.media_type === "image/jpeg" && t?.referral?.media_url === "https://cdn.example/ad.jpg");

const p = parseWhatsAppInbound(twilioPlain);
ok("non-ad message parses", p && p.from === "+61400000002");
ok("non-ad message has NO referral (null, not {})", p.referral === null, String(p?.referral));

const m = parseWhatsAppInbound(metaCtwa);
ok("meta: message still parses", m && m.from === "+61400000003", m?.from);
ok("meta: ctwa_clid captured", m?.referral?.ctwa_clid === "ARMetaClickId");
ok("meta: ad id captured", m?.referral?.source_id === "120210000000000002");
ok("meta: video url captured", m?.referral?.media_url === "https://cdn.example/ad.mp4");

// Long values must not blow up the jsonb column.
const long = parseWhatsAppInbound({
  body: { From: "whatsapp:+61400000004", Body: "hi", MessageSid: "SM_long", ReferralHeadline: "x".repeat(5000), ReferralCtwaClid: "C1" },
});
ok("over-long field is capped", long?.referral?.headline.length === 400, `len=${long?.referral?.headline.length}`);

let pass = 0;
for (const [n, c, d] of results) {
  console.log(`${c ? "PASS" : "FAIL"}  ${n}${d && !c ? `  — got: ${d}` : ""}`);
  if (c) pass++;
}
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
