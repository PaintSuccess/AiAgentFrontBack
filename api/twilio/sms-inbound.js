const { corsHeaders } = require("../../lib/shopify");

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Twilio sends form-urlencoded by default
    const from = req.body.From;
    const body = req.body.Body;
    const messageSid = req.body.MessageSid;

    console.log(`[SMS] From: ${from}, Message: ${body}`);

    if (!from || !body) {
      return res.status(400).send("<Response><Message>Invalid request</Message></Response>");
    }

    // Send to ElevenLabs as a text conversation
    const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
    const AGENT_ID = process.env.ELEVENLABS_AGENT_ID;

    // Start a text conversation with ElevenLabs
    const conversationRes = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation`,
      {
        method: "POST",
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          agent_id: AGENT_ID,
          text: body,
          dynamic_variables: {
            customer_phone: from,
          },
        }),
      }
    );

    let replyText = "Thanks for contacting Paint Access! We're processing your message. For immediate help, call us at 028-064-70-50 or visit paintaccess.com.au";

    if (conversationRes.ok) {
      const data = await conversationRes.json();
      if (data.response) {
        replyText = data.response;
      }
    } else {
      console.error("ElevenLabs API error:", await conversationRes.text());
    }

    // Respond with TwiML
    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send(
      `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${escapeXml(replyText)}</Message>
</Response>`
    );
  } catch (err) {
    console.error("SMS webhook error:", err);
    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send(
      `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Sorry, we're experiencing a technical issue. Please call us at 028-064-70-50.</Message>
</Response>`
    );
  }
};

function escapeXml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
