---
name: shopify-graphql-safe-mutation
description: perform safe shopify admin graphql write operations when no dedicated shopify tool exists. use for updating order notes, metafields, tags, custom attributes, resources, or other shopify admin changes that require graphql. trigger whenever a shopify mutation is needed and the exact mutation/input fields must be discovered, validated, and executed safely before reporting results.
---

# Shopify GraphQL Safe Mutation

Use this skill only for Shopify writes that are not covered by the `PaintAccess Shopify Operations` MCP. Prefer MCP tools first: `shopify_add_order_note`, `shopify_add_order_tag`, `shopify_remove_order_tag`, `shopify_set_ops_metafield`, `shopify_prepare_fulfillment`, and `shopify_prepare_cancellation`.

## Mandatory workflow

1. Inspect the GraphQL schema before constructing the mutation.
2. Inspect the relevant input type.
3. Build the smallest possible mutation.
4. Validate the GraphQL operation.
5. Execute only after validation passes.
6. Read `userErrors` and report the practical result, not raw JSON.

Before step 1, state why the existing MCP tool set is insufficient. If the request can be done through the MCP, stop and route to the MCP instead.

## Rules

- Do not guess mutation names or input fields.
- Do not skip validation.
- Do not execute dangerous financial, staff, theme-live, gift card, or blocked mutations.
- Prefer narrow mutations that update only the requested fields.
- Include resource IDs only after safe lookup.

## Reporting

After execution, say:

- what resource changed;
- what field/note/tag was updated;
- whether `userErrors` were returned;
- what manual action remains.

See `references/graphql-mutation-safety.md`.
