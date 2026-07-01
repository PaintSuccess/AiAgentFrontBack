# GraphQL mutation safety

## Required sequence

Schema discovery -> input discovery -> mutation draft -> validation -> execution -> userErrors review.

## Common use case: no dedicated MCP mutation

Use this flow when the user says:

- "set a controlled metafield";
- "add/remove a tag when the normal tag tool is unavailable";
- "perform this safe Shopify write and there is no dedicated MCP tool".

Do not use this flow for operational order logs. Use `shopify_record_order_timeline_entry` through the PaintAccess Operations MCP instead of writing to the persistent Shopify Notes field.

## Failure handling

If validation fails:

1. Read the validation error.
2. Re-inspect schema/input if needed.
3. Fix the mutation.
4. Validate again before executing.

If execution returns userErrors:

1. Summarize the error.
2. Do not claim success.
3. Suggest a safe next action.
