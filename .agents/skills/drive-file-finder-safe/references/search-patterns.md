# Drive search patterns

Use exact, separate searches. Google Drive search is not Gmail search; broad `OR` phrases can be treated literally by the MCP/backend.

## Order files

Search separately:

```text
name_contains: "{order_number_without_hash}"
query: "{order_number_without_hash}"
query: "PO {order_number_without_hash}"
query: "#{order_number_without_hash}"
```

## Supplier files

Search separately:

```text
query: "{supplier} {order_number_without_hash}"
query: "{supplier} PO"
query: "{supplier} confirmation"
```

## Customer files

Search separately:

```text
query: "{customer_email}"
query: "{customer_name} {order_number_without_hash}"
```

## Tracking or confirmation files

Search separately:

```text
query: "{tracking_number}"
query: "{confirmation_number}"
query: "{carrier} {tracking_number}"
```

## Interpretation

- `0` matches with a successful response means Drive auth works but no file was found.
- Multiple matches require user selection unless one file clearly matches the order/supplier context.
- Do not read file content unless the candidate is relevant and the task needs its content.
