const { corsHeaders } = require("../../lib/shopify");

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Twilio WhatsApp sends form-urlencoded
    const from = req.body.From; // e.g., whatsapp:+61412345678
    const body = req.body.Body;
    const profileName = req.body.ProfileName;

    console.log(`[WhatsApp] From: ${from}, Name: ${profileName}, Message: ${body}`);

    if (!from || !body) {
      res.setHeader("Content-Type", "text/xml");
      return res.status(400).send("<Response><Message>Invalid request</Message></Response>");
    }

    const phoneNumber = from.replace("whatsapp:", "");

    // Send to ElevenLabs as a text conversation
    const ELEVENLABS_API_KEY = (process.env.ELEVENLABS_API_KEY || "").trim();
    const AGENT_ID = (process.env.ELEVENLABS_AGENT_ID || "").trim();

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
            customer_name: profileName || "",
            customer_phone: phoneNumber,
          },
        }),
      }
    );

    let replyText = "Thanks for contacting Paint Access! For immediate help, call us at 028-064-70-50 or visit paintaccess.com.au";

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
    console.error("WhatsApp webhook error:", err);
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
