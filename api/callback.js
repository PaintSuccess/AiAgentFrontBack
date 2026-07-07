const {
  shopifyFetch,
  corsHeaders,
  cleanEnv,
  sanitizeInput,
  rateLimit,
} = require("../lib/shopify");

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{1,63}$/;

function isPhoneValidationError(err) {
  const upstream = String(err?.upstream || "");
  return err?.statusCode === 422 && /"phone"\s*:/i.test(upstream);
}

function isEmailTakenError(err) {
  const upstream = String(err?.upstream || "");
  return err?.statusCode === 422 && /"email"\s*:\s*\[.*already been taken/i.test(upstream);
}

// Public-facing endpoint — no Bearer auth required (called by storefront widget).
// Accepts callback request form data, logs it as a Shopify draft order, then
// triggers an ElevenLabs outbound AI call to the customer's number via Twilio.
//
// DISABLED BY DEFAULT (ENABLE_AI_CALLBACK unset/not "true"): this endpoint is not
// currently wired to any widget/dashboard UI, and outbound AI phone calls to a
// customer-submitted number raise open consent/compliance questions (Australian
// Spam Act / Do Not Call Register) that haven't been resolved yet. The rest of
// this handler is left intact -- flip ENABLE_AI_CALLBACK=true to restore it once
// that's settled; no other code change needed.
module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (cleanEnv("ENABLE_AI_CALLBACK") !== "true") {
    return res.status(404).json({ error: "Not found" });
  }
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (await rateLimit(req, res)) return;

  const { name, phone, email, best_time, message } = req.body || {};

  // Validate required fields
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: "Name is required." });
  }
  if (!phone || !String(phone).trim()) {
    return res.status(400).json({ error: "Phone number is required." });
  }

  // Sanitise / truncate inputs
  const cleanName    = sanitizeInput(name, 100);
  const cleanPhone   = String(phone).trim().replace(/\s/g, "").slice(0, 30);
  const emailInput   = sanitizeInput(email || "", 200).toLowerCase();
  const cleanEmail   = EMAIL_RE.test(emailInput) ? emailInput : "";
  const cleanMsg     = sanitizeInput(message || "", 500);
  const cleanTime    = sanitizeInput(best_time || "", 100);

  // ---- 1. Log as Shopify draft order (CRM record) -----------------------
  let draftOrderId = null;
  try {
    const note = [
      "[AI Callback Request]",
      `Name:      ${cleanName}`,
      `Phone:     ${cleanPhone}`,
      cleanEmail ? `Email:     ${cleanEmail}` : null,
      cleanTime  ? `Best time: ${cleanTime}`  : null,
      cleanMsg   ? `Message:   ${cleanMsg}`   : null,
    ]
      .filter(Boolean)
      .join("\n");

    const draftOrder = await shopifyFetch("draft_orders.json", {
      method: "POST",
      body: JSON.stringify({
        draft_order: {
          line_items: [
            {
              title: "AI Callback Request",
              quantity: 1,
              price: "0.00",
            },
          ],
          note,
          ...(cleanEmail ? { email: cleanEmail } : {}),
          tags: "ai-assistant,callback-request",
        },
      }),
    });
    draftOrderId = draftOrder.draft_order?.id || null;
    console.log("[Callback] Draft order created:", draftOrderId);
  } catch (err) {
    // Non-fatal — still attempt the call
    console.error("[Callback] Draft order error:", err.message);
  }

  // ---- 1b. Upsert Shopify customer -----------------------------------------
  // Creates or updates a customer record so callback requestors are visible
  // in Shopify CRM. Non-fatal — a failure here never blocks the outbound call.
  // Requires write_customers scope on the Shopify access token.
  if (cleanEmail || cleanPhone) {
    try {
      const nameParts = cleanName.split(/\s+/);
      const callbackTags = ["AI Agent", "ai-lead", "ai-widget", "callback-request"];
      const callbackNote = [
        "SMS callback request via AI widget",
        cleanTime  ? `Best time: ${cleanTime}`  : null,
        cleanMsg   ? `Message: ${cleanMsg}`     : null,
      ].filter(Boolean).join(" | ");

      if (cleanEmail) {
        // Search by email first to avoid duplicates
        const search = await shopifyFetch(
          `customers/search.json?query=email:${encodeURIComponent(cleanEmail)}&limit=1`
        );
        const existing = search.customers?.[0];

        if (existing) {
          // The public callback form cannot prove the requester owns this
          // email address. Leave the Shopify customer untouched; the draft
          // order above still gives the team the callback context.
          console.log("[Callback] Existing customer left untouched:", existing.id);
        } else {
          const customerPayload = {
            first_name: nameParts[0] || cleanName,
            last_name:  nameParts.slice(1).join(" ") || "",
            email:      cleanEmail,
            ...(cleanPhone ? { phone: cleanPhone } : {}),
            tags:       callbackTags.join(","),
            note:       callbackNote,
            accepts_marketing: false,
            verified_email:    false,
          };
          let created;
          try {
            created = await shopifyFetch("customers.json", {
              method: "POST",
              body: JSON.stringify({ customer: customerPayload }),
            });
          } catch (err) {
            if (isEmailTakenError(err)) {
              console.log("[Callback] Existing customer left untouched after create:", cleanEmail);
            } else if (!isPhoneValidationError(err) || !cleanPhone) {
              throw err;
            } else {
            delete customerPayload.phone;
            try {
              created = await shopifyFetch("customers.json", {
                method: "POST",
                body: JSON.stringify({ customer: customerPayload }),
              });
            } catch (retryErr) {
              if (isEmailTakenError(retryErr)) {
                console.log("[Callback] Existing customer left untouched after retry:", cleanEmail);
                created = null;
              } else {
                throw retryErr;
              }
            }
            if (created) console.log("[Callback] Customer created without duplicate phone:", created.customer?.id);
            }
          }
          if (created) console.log("[Callback] Customer created:", created.customer?.id);
        }
      }
    } catch (err) {
      // Non-fatal — scopes may not include write_customers yet
      console.error("[Callback] Customer upsert error:", err.message);
    }
  }

  // ---- 2. Trigger outbound AI call via ElevenLabs Twilio integration ----
  const AGENT_ID      = cleanEnv("ELEVENLABS_AGENT_ID");
  const XI_KEY        = cleanEnv("ELEVENLABS_API_KEY");
  const PHONE_NUM_ID  = cleanEnv("ELEVENLABS_PHONE_NUMBER_ID");

  let callError = null;

  if (AGENT_ID && XI_KEY && PHONE_NUM_ID) {
    try {
      const callRes = await fetch(
        "https://api.elevenlabs.io/v1/convai/twilio/outbound_call",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "xi-api-key": XI_KEY,
          },
          body: JSON.stringify({
            agent_id:               AGENT_ID,
            agent_phone_number_id:  PHONE_NUM_ID,
            to_number:              cleanPhone,
          }),
        }
      );

      if (!callRes.ok) {
        const errText = await callRes.text();
        callError = `ElevenLabs ${callRes.status}: ${errText.slice(0, 200)}`;
        console.error("[Callback] Outbound call error:", callError);
      } else {
        const callData = await callRes.json();
        console.log("[Callback] Outbound call initiated:", callData);
      }
    } catch (err) {
      callError = err.message;
      console.error("[Callback] Call trigger error:", err.message);
    }
  } else {
    callError = "Outbound call not configured";
    console.error("[Callback] Missing ELEVENLABS_AGENT_ID / ELEVENLABS_API_KEY / ELEVENLABS_PHONE_NUMBER_ID");
  }

  return res.status(200).json({
    ok: true,
    message: callError
      ? "Your callback request has been logged. Our team will call you shortly."
      : "Thanks! Our AI assistant is calling you now.",
    call_error: callError || null,
    draft_order_id: draftOrderId,
  });
};
