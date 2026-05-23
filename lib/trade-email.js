const { cleanEnv, shopifyFetch } = require("./shopify");

const TRADE_EMAIL = cleanEnv("TRADE_NOTIFICATION_EMAIL") || "Trade@paintaccess.com.au";
const SENDGRID_API_KEY = cleanEnv("SENDGRID_API_KEY");
const SENDGRID_FROM_EMAIL = cleanEnv("SENDGRID_FROM_EMAIL") || TRADE_EMAIL;
const SENDGRID_FROM_NAME = cleanEnv("SENDGRID_FROM_NAME") || "Paint Access AI";

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatTranscript(transcript = []) {
  if (!Array.isArray(transcript) || !transcript.length) return "No transcript available.";

  return transcript
    .map((entry) => {
      const role = entry.role || entry.speaker || "unknown";
      const message = entry.message || entry.text || "";
      const time = entry.time_in_call_secs != null ? `[${entry.time_in_call_secs}s] ` : "";
      return `${time}${String(role).toUpperCase()}: ${message}`;
    })
    .join("\n\n")
    .trim();
}

function formatFields(fields = {}) {
  return Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}

function textToHtml(text) {
  return `<pre style="white-space:pre-wrap;font:14px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#1f2933;">${escapeHtml(text)}</pre>`;
}

async function sendTradeEmail({ subject, text, html, replyTo }) {
  if (!SENDGRID_API_KEY) {
    return sendTradeEmailViaShopify({ subject, text });
  }

  return sendTradeEmailViaSendGrid({ subject, text, html, replyTo });
}

async function sendTradeEmailViaSendGrid({ subject, text, html, replyTo }) {
  if (!SENDGRID_API_KEY) {
    console.warn("[Trade Email] SENDGRID_API_KEY is not configured; notification skipped.");
    return { sent: false, skipped: true };
  }

  const payload = {
    personalizations: [
      {
        to: [{ email: TRADE_EMAIL }],
        subject: subject || "Paint Access AI notification",
      },
    ],
    from: {
      email: SENDGRID_FROM_EMAIL,
      name: SENDGRID_FROM_NAME,
    },
    content: [
      {
        type: "text/plain",
        value: text || "",
      },
      {
        type: "text/html",
        value: html || textToHtml(text || ""),
      },
    ],
  };

  if (replyTo) {
    payload.reply_to = { email: replyTo };
  }

  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SENDGRID_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`SendGrid ${response.status}: ${body.slice(0, 300)}`);
  }

  return { sent: true };
}

async function sendTradeEmailViaShopify({ subject, text }) {
  const draftOrder = await shopifyFetch("draft_orders.json", {
    method: "POST",
    body: JSON.stringify({
      draft_order: {
        line_items: [
          {
            title: subject || "AI Communication Log",
            quantity: 1,
            price: "0.00",
          },
        ],
        note: text || "",
        email: TRADE_EMAIL,
        tags: "ai-assistant,communication-log,trade-notification",
      },
    }),
  });

  const draftId = draftOrder.draft_order?.id;
  if (!draftId) {
    throw new Error("Shopify draft order was not created for trade notification.");
  }

  await shopifyFetch(`draft_orders/${draftId}/send_invoice.json`, {
    method: "POST",
    body: JSON.stringify({
      draft_order_invoice: {
        to: TRADE_EMAIL,
        subject: subject || "Paint Access AI communication log",
        custom_message: text || "",
      },
    }),
  });

  return { sent: true, provider: "shopify", draft_order_id: draftId };
}

async function notifyTradeEmail(notification) {
  try {
    return await sendTradeEmail(notification);
  } catch (err) {
    console.error("[Trade Email] Notification failed:", err.message);
    return { sent: false, error: err.message };
  }
}

module.exports = {
  TRADE_EMAIL,
  escapeHtml,
  formatFields,
  formatTranscript,
  notifyTradeEmail,
  textToHtml,
};
