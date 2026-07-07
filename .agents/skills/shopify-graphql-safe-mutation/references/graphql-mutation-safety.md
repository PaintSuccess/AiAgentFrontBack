# GraphQL mutation safety

## There is no runtime "execute GraphQL" capability

The PaintAccess Operations MCP has 19 fixed tools and no generic mutation-execution tool. An agent cannot inspect the schema, validate, and execute a mutation at runtime through this MCP — that capability does not exist, by design (arbitrary GraphQL execution requires Admin approval per the PRD, not agent-level access).

## Common trigger: no dedicated MCP mutation

If the user says something like:

- "set a controlled metafield";
- "add/remove a tag when the normal tag tool is unavailable";
- "perform this safe Shopify write and there is no dedicated MCP tool";

...stop and tell the user a developer needs to add a narrow, dedicated MCP tool for this specific write. Do not attempt the write through any other channel.

Do not use this skill for operational order logs either way. Use `shopify_record_order_timeline_entry` through the PaintAccess Operations MCP instead of writing to the persistent Shopify Notes field.

## Sequence a developer should follow when adding the new tool

Schema discovery -> input discovery -> mutation draft -> validation -> execution -> userErrors review.

If validation fails during development:

1. Read the validation error.
2. Re-inspect schema/input if needed.
3. Fix the mutation.
4. Validate again before shipping.

If execution returns userErrors once the tool is live:

1. Summarize the error.
2. Do not claim success.
3. Suggest a safe next action.
