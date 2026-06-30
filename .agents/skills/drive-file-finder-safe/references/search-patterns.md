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

Stop here when the task only asks whether an order-numbered Drive file exists. Report zero direct matches instead of widening into unrelated operational files.

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

Customer-only searches are fallback searches. Label matches low confidence unless the file name or content also contains the exact order number or another order-specific identifier.

## Tracking or confirmation files

Search separately:

```text
query: "{tracking_number}"
query: "{confirmation_number}"
query: "{carrier} {tracking_number}"
```

## Interpretation

- `0` matches with a successful response means Drive auth works but no file was found.
- Broad fallback matches are not evidence of an order file unless they contain a second order-specific signal.
- Multiple matches require user selection unless one file clearly matches the order/supplier context.
- Do not read file content unless the candidate is relevant and the task needs its content.
