import fs from "node:fs";

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

const API_KEY = process.env.ELEVENLABS_API_KEY;
const AGENT_ID = process.env.ELEVENLABS_AGENT_ID;
const BACKEND_URL =
  process.env.BACKEND_URL || "https://ai-agent-front-back.vercel.app";
const API_SECRET =
  process.env.API_SECRET_TOKEN || "CHANGE_ME_AFTER_DEPLOY";

// ─── Tool definitions ───
const toolDefs = [
  {
    tool_config: {
      type: "webhook",
      name: "lookup_order",
      description:
        "Look up a customer's order status, tracking information, and fulfillment details. Use when a customer asks about their order, tracking, delivery status, or where their order is. For privacy, always collect BOTH the order number and the email used for that order before calling this tool.",
      // Speak a filler ("Let me check that for you…") + play typing sound
      // while the webhook runs. Without this the user hears ~5–10s of dead air
      // because the LLM blocks until the tool returns.
      force_pre_tool_speech: true,
      pre_tool_speech: "force",
      tool_call_sound: "typing",
      tool_call_sound_behavior: "always",
      api_schema: {
        url: `${BACKEND_URL}/api/shopify/order`,
        method: "POST",
        request_headers: {
          Authorization: `Bearer ${API_SECRET}`,
        },
        request_body_schema: {
          type: "object",
          required: ["order_number", "email"],
          properties: {
            order_number: {
              type: "string",
              description:
                "The order number (e.g., 1001 or #1001). Required.",
            },
            email: {
              type: "string",
              description:
                "The email address used when placing that order. Required.",
            },
          },
        },
      },
    },
  },
  {
    tool_config: {
      type: "webhook",
      name: "search_products",
      description:
        "Search for products on the Paint Access website by name, brand, type, or category. Use when a customer asks about a specific product, wants recommendations, asks about prices, or wants to find a product. Returns product details including prices, availability, and direct links. Website widget / browser voice contract: after this tool returns products, the next action must be display_products_in_chat before speaking product details or saying anything is on the customer's screen.",
      // See lookup_order — same rationale.  search_products is the worst
      // offender for perceived latency because the LLM also has to ingest
      // the JSON and craft a spoken response.
      force_pre_tool_speech: true,
      pre_tool_speech: "force",
      tool_call_sound: "typing",
      tool_call_sound_behavior: "always",
      api_schema: {
        url: `${BACKEND_URL}/api/shopify/products`,
        method: "POST",
        request_headers: {
          Authorization: `Bearer ${API_SECRET}`,
        },
        request_body_schema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description:
                "Search term: product name, brand (e.g., Graco, Mirka, Taubmans), or product type (e.g., paint sprayer, sander, primer).",
            },
            collection: {
              type: "string",
              description:
                "Collection handle to browse (e.g., airless-paint-sprayers, sanders). Use when customer wants to browse a category.",
            },
          },
        },
      },
    },
  },
  {
    tool_config: {
      type: "webhook",
      name: "check_inventory",
      description:
        "Check the stock availability and inventory level of a specific product or SKU. Use when a customer asks if something is in stock, available, or wants to know the quantity available.",
      api_schema: {
        url: `${BACKEND_URL}/api/shopify/inventory`,
        method: "POST",
        request_headers: {
          Authorization: `Bearer ${API_SECRET}`,
        },
        request_body_schema: {
          type: "object",
          properties: {
            product_name: {
              type: "string",
              description: "Product name or partial name to search for.",
            },
            sku: {
              type: "string",
              description:
                "Product SKU code for exact inventory lookup.",
            },
          },
        },
      },
    },
  },
  {
    tool_config: {
      type: "webhook",
      name: "send_email_notification",
      description:
        "Send an email notification or escalation. Use when: (1) a customer wants a quote emailed, (2) a customer needs a follow-up email, (3) conversation needs escalation to human agent via email, (4) customer wants product info sent to their email.",
      api_schema: {
        url: `${BACKEND_URL}/api/email/send`,
        method: "POST",
        request_headers: {
          Authorization: `Bearer ${API_SECRET}`,
        },
        request_body_schema: {
          type: "object",
          required: ["to", "subject", "message"],
          properties: {
            to: {
              type: "string",
              description:
                "Recipient email address. Use the customer's email if known, or ask them.",
            },
            subject: {
              type: "string",
              description: "Email subject line.",
            },
            message: {
              type: "string",
              description: "Email body content in plain text.",
            },
            type: {
              type: "string",
              description:
                "Type of email: 'customer' (to customer), 'escalation' (to Paint Access team), 'quote' (product quote).",
            },
          },
        },
      },
    },
  },
  {
    tool_config: {
      type: "webhook",
      name: "send_sms_notification",
      description:
        "Website widget and voice/browser only: send a concise SMS with Paint Access links or follow-up details to an Australian mobile number. Never use this tool when the current channel is SMS or WhatsApp; those channels must receive product links directly in the same channel. If the caller is on an office/landline number or no mobile is available, ask for their mobile first. Only send paintaccess.com.au links.",
      api_schema: {
        url: `${BACKEND_URL}/api/twilio/sms-notification`,
        method: "POST",
        request_headers: {
          Authorization: `Bearer ${API_SECRET}`,
        },
        request_body_schema: {
          type: "object",
          required: ["to", "message"],
          properties: {
            to: {
              type: "string",
              description:
                "Australian mobile number to receive the SMS, e.g. 0410609617 or +61410609617. Do not use landlines.",
            },
            message: {
              type: "string",
              description:
                "Short SMS body containing useful Paint Access links. Links must be on paintaccess.com.au.",
            },
          },
        },
      },
    },
  },
  {
    // Client-side tool. Signals the browser to close the widget after a
    // farewell. The widget JS schedules a 7-second countdown and optionally
    // calls endSession() after 1.5s if the built-in end_call doesn't fire.
    // Must be called IN THE SAME RESPONSE as the farewell message.
    tool_config: {
      type: "client",
      name: "end_conversation",
      description:
        "Call this IN THE SAME RESPONSE as your farewell message to close the conversation widget. Required for every goodbye — no exceptions. Do NOT call it mid-conversation. Call it once, together with your farewell text (e.g. 'Happy painting! Have a great one!').",
      expects_response: false,
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    // Client-side tool. The widget's JS handler receives the call and
    // renders the products as cards in the chat panel. Used so voice
    // customers don't have to listen to long URLs / SKUs read aloud.
    tool_config: {
      type: "client",
      name: "display_products_in_chat",
      description:
        "Mandatory website widget / browser voice display tool. Use this to send search_products results to the on-screen product cards. Call immediately after every successful search_products result whenever this client tool is available, before speaking product details or claiming anything is on the customer's screen. Never read URLs, SKUs or long product names aloud. After this tool succeeds, briefly say 'I've put the details on your screen' and continue. Do not call in SMS or WhatsApp.",
      expects_response: false,
      parameters: {
        type: "object",
        required: ["products"],
        properties: {
          intro: {
            type: "string",
            description:
              "Short intro line shown above the cards (e.g. 'Here are 3 Graco sprayers that fit your needs:').",
          },
          products: {
            type: "array",
            description: "Up to 5 products to display.",
            items: {
              type: "object",
              required: ["name", "url"],
              properties: {
                name: { type: "string", description: "Product name." },
                url: {
                  type: "string",
                  description:
                    "Full product page URL on paintaccess.com.au.",
                },
                price: {
                  type: "string",
                  description: "Price as displayed (e.g. '$1,299 AUD').",
                },
                note: {
                  type: "string",
                  description: "Short reason this product was chosen.",
                },
              },
            },
          },
        },
      },
    },
  },
  {
    // Webhook tool. Creates or updates a Shopify customer record when a
    // guest shares their contact details during a conversation.
    // Requires write_customers scope on the Shopify access token.
    tool_config: {
      type: "webhook",
      name: "capture_lead",
      description:
        "Save a new customer's contact details in the Paint Access CRM (Shopify) with the AI Agent source tag. " +
        "Call ONCE per useful guest conversation after the customer has shared, or the session already provides, their name and email, " +
        "and after they agree Paint Access may add them in the customer database for follow-up communication. " +
        "If the customer asks to be registered, added to the user list, saved for follow-up, or contacted by the team, collect and confirm name plus email, then call this tool before claiming anything was saved. " +
        "Never say details were saved, added, registered, or updated unless this tool has already returned action 'created'. " +
        "This tool creates a Paint Access customer/contact record for follow-up; it does not create a website login account, password, or completed online account. Do not say the customer can now log in. " +
        "For voice calls, if you ask the customer to confirm their email, phone, or name, wait for their next reply before calling this tool. Do not call this tool in the same turn as 'is that right?' or any confirmation question. " +
        "This tool is not a goodbye action: after action 'created', speak the saved-for-follow-up message and ask whether they need anything else before checkout. Do not call end_conversation/end_call immediately after this tool unless the customer gives a new clear goodbye after the saved message. " +
        "For security, if Shopify already has that email, the backend will not modify the existing customer from this public AI flow. " +
        "For guests, first collect first name, last name, email, and phone if useful. Do NOT call for logged-in customers with a customer_id. Do NOT call more than once per session. " +
        "After action 'created', say 'Perfect, I've saved your details so the Paint Access team can follow up. Would you like anything else before you check out?' and continue naturally. If action is 'skipped', do not claim the customer record was changed.",
      force_pre_tool_speech: false,
      api_schema: {
        url: `${BACKEND_URL}/api/shopify/customer`,
        method: "POST",
        request_headers: {
          Authorization: `Bearer ${API_SECRET}`,
        },
        request_body_schema: {
          type: "object",
          required: ["name", "email"],
          properties: {
            name: {
              type: "string",
              description: "Customer's full name as they provided it.",
            },
            email: {
              type: "string",
              description: "Customer's email address.",
            },
            phone: {
              type: "string",
              description: "Customer's phone number (optional, include if shared).",
            },
            note: {
              type: "string",
              description: "One-line context, e.g. 'Interested in airless sprayers'.",
            },
          },
        },
      },
    },
  },
];

async function createTools() {
  console.log("Creating ElevenLabs webhook tools...\n");

  const createdToolIds = [];

  for (const toolDef of toolDefs) {
    const name = toolDef.tool_config.name;
    console.log(`Creating tool: ${name}...`);

    const res = await fetch("https://api.elevenlabs.io/v1/convai/tools", {
      method: "POST",
      headers: {
        "xi-api-key": API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(toolDef),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`  ❌ Failed: ${res.status} ${err}`);
      continue;
    }

    const data = await res.json();
    console.log(`  ✅ Created: ${data.id}`);
    createdToolIds.push(data.id);
  }

  console.log(`\n${createdToolIds.length}/${toolDefs.length} tools created.`);
  console.log("Tool IDs:", createdToolIds);

  if (createdToolIds.length === 0) {
    console.error("\n❌ No tools created. Cannot attach to agent.");
    process.exit(1);
  }

  // Now attach tools to the agent
  console.log(`\nAttaching ${createdToolIds.length} tools to agent ${AGENT_ID}...`);

  const updatePayload = {
    conversation_config: {
      agent: {
        prompt: {
          tool_ids: createdToolIds,
        },
      },
    },
  };

  const updateRes = await fetch(
    `https://api.elevenlabs.io/v1/convai/agents/${AGENT_ID}`,
    {
      method: "PATCH",
      headers: {
        "xi-api-key": API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(updatePayload),
    }
  );

  if (!updateRes.ok) {
    const err = await updateRes.text();
    throw new Error(`Failed to update agent: ${updateRes.status} ${err}`);
  }

  const result = await updateRes.json();
  const attachedTools =
    result.conversation_config?.agent?.prompt?.tool_ids || [];
  console.log(`\n✅ Agent updated! tool_ids: [${attachedTools.join(", ")}]`);

  // Verify
  console.log("\nVerifying agent tools...");
  const verifyRes = await fetch(
    `https://api.elevenlabs.io/v1/convai/agents/${AGENT_ID}`,
    {
      headers: { "xi-api-key": API_KEY },
    }
  );
  const agentData = await verifyRes.json();
  const toolIds = agentData.conversation_config?.agent?.prompt?.tool_ids || [];
  const tools = agentData.conversation_config?.agent?.tools || [];

  console.log(`  tool_ids (${toolIds.length}):`, toolIds);
  console.log(`  tools (${tools.length}):`, tools.map(t => t.tool_config?.name || t.id));
}

createTools().catch((err) => {
  console.error("\n❌ Error:", err.message);
  process.exit(1);
});
