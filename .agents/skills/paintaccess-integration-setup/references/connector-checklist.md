# Connector checklist

## Shopify

Needs access to:

- read orders;
- read products/variants;
- update order notes/tags/metafields;
- prepare tracking/fulfilment updates;
- run Admin GraphQL queries/mutations when no dedicated tool exists.

## Gmail

Needs access to:

- create drafts;
- search messages;
- read supplier Sales Confirmation emails;
- read supplier tracking emails;
- optionally send email after Daniel approval.

## Google Drive

Needed only if PO files or attachments are stored/generated in Drive.

Needs access to:

- create files;
- read selected PO templates/files;
- attach/export PO documents if required.

## GitHub

Target repository:

```text
PaintSuccess/AiAgentFrontBack
```

Do not publish secrets or local credential files.
