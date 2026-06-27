const { shopifyGraphQL } = require("./shopify");

const AI_CALL_NOTIFICATION_TYPE = "paint_access_ai_call_notification";

function field(key, value) {
  if (value === undefined || value === null || value === "") return null;
  return { key, value: String(value) };
}

function jsonField(key, value) {
  if (value === undefined || value === null) return null;
  return { key, value: JSON.stringify(value) };
}

function compactFields(fields) {
  return fields.filter(Boolean);
}

async function createAiCallNotification(fields) {
  const mutation = `
    mutation CreateAiCallNotification($metaobject: MetaobjectCreateInput!) {
      metaobjectCreate(metaobject: $metaobject) {
        metaobject {
          id
          handle
          type
        }
        userErrors {
          field
          message
          code
        }
      }
    }
  `;

  const payload = {
    type: AI_CALL_NOTIFICATION_TYPE,
    fields: compactFields([
      field("event_type", fields.event_type),
      field("channel", fields.channel),
      field("subject", fields.subject),
      field("conversation_id", fields.conversation_id),
      field("status", fields.status),
      field("agent", fields.agent),
      field("started_at", fields.started_at),
      field("duration", fields.duration),
      field("result", fields.result),
      field("customer_name", fields.customer_name),
      field("customer_email", fields.customer_email),
      field("customer_phone", fields.customer_phone),
      field("called_number", fields.called_number),
      field("summary", fields.summary),
      field("transcript", fields.transcript),
      jsonField("raw_payload", fields.raw_payload),
    ]),
  };

  const result = await shopifyGraphQL(mutation, { metaobject: payload });
  const errors = result.metaobjectCreate?.userErrors || [];
  if (errors.length) {
    const err = new Error(`Shopify metaobjectCreate failed: ${JSON.stringify(errors)}`);
    err.userErrors = errors;
    throw err;
  }

  return {
    created: true,
    provider: "shopify_metaobject",
    metaobject: result.metaobjectCreate.metaobject,
  };
}

module.exports = {
  AI_CALL_NOTIFICATION_TYPE,
  createAiCallNotification,
};
