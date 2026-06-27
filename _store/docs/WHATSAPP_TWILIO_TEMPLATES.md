# WhatsApp Twilio Templates

Created and submitted through Twilio Content API on 25 June 2026.

| Purpose | Friendly name | Content SID | WhatsApp approval status | Category |
| --- | --- | --- | --- | --- |
| Support follow-up | `paintaccess_support_followup` | `HX16c0d6dd46ab8a723abeb5a40a71eaf1` | `pending` | `UTILITY` |
| Quote/product recommendation ready | `paintaccess_quote_ready` | `HX9af22c2f9759a65876df3ff384e39a4e` | `pending` | `UTILITY` |
| Order/enquiry update | `paintaccess_order_enquiry_update` | `HXf8bedd018a0dfc8674326aca1147fa39` | `pending` | `UTILITY` |

## Template Bodies

`paintaccess_support_followup`

```text
Hi {{1}}, this is Paint Access. We are following up on your support request. Reply here and Jessica or our team will help.
```

`paintaccess_quote_ready`

```text
Hi {{1}}, your Paint Access quote or product recommendation is ready: {{2}}. Reply here if you need help choosing the right product.
```

`paintaccess_order_enquiry_update`

```text
Hi {{1}}, Paint Access has an update about {{2}}. Reply here if you need help from our team.
```

## Sending Through Backend

Use `POST /api/whatsapp/send` with `Authorization: Bearer <API_SECRET_TOKEN>`:

```json
{
  "to": "+61400000000",
  "type": "template",
  "template": {
    "contentSid": "HX16c0d6dd46ab8a723abeb5a40a71eaf1",
    "variables": {
      "1": "Customer"
    }
  }
}
```

The backend also resolves these template keys from Vercel env:

| Template key | Env var |
| --- | --- |
| `support_followup` | `WHATSAPP_TEMPLATE_SUPPORT_FOLLOWUP` |
| `quote_ready` | `WHATSAPP_TEMPLATE_QUOTE_READY` |
| `order_enquiry_update` | `WHATSAPP_TEMPLATE_ORDER_ENQUIRY_UPDATE` |

Example:

```json
{
  "to": "+61400000000",
  "type": "template",
  "template": {
    "key": "support_followup",
    "variables": {
      "1": "Customer"
    }
  }
}
```

Templates must be approved by WhatsApp before they can be used outside the 24-hour customer service window.
