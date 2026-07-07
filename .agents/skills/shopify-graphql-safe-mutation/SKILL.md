---
name: shopify-graphql-safe-mutation
description: use when a shopify admin write is needed that has no dedicated MCP tool (metafields, tags, custom attributes, or other shopify admin changes requiring graphql). this MCP has no generic execute-graphql tool, so the correct action is to stop and ask a developer to add a narrow tool, not to attempt raw GraphQL execution. do not use GraphQL to write operational order logs into the persistent Shopify Notes field; prefer shopify_record_order_timeline_entry through the PaintAccess Operations MCP.
---

# Shopify GraphQL Safe Mutation

Use this skill only for Shopify writes that are not covered by the `PaintAccess Operations` MCP. Prefer MCP tools first: `shopify_record_order_timeline_entry`, `shopify_add_order_tag`, `shopify_remove_order_tag`, `shopify_set_ops_metafield`, `shopify_prepare_fulfillment`, `shopify_prepare_cancellation`, `shopify_prepare_customer_email`, and `shopify_send_customer_email`.

**This MCP does not support arbitrary GraphQL execution.** There is no `shopify_execute_approved_graphql_operation` or `shopify_validate_graphql_operation` tool, and none is planned — arbitrary mutation execution is explicitly out of scope per the PRD's approval model (it requires Admin approval, not agent-level access). If the request cannot be done through one of the named MCP tools above, **stop and ask a developer to add a dedicated, narrow MCP tool for it.** Do not attempt to discover, validate, or execute a raw GraphQL mutation yourself through any other means.

## If a developer is adding a new tool

The workflow below is guidance for the *developer* implementing a new narrow MCP tool, not something the agent performs at runtime:

1. Inspect the GraphQL schema before constructing the mutation.
2. Inspect the relevant input type.
3. Build the smallest possible mutation.
4. Validate the GraphQL operation.
5. Execute only after validation passes.
6. Read `userErrors` and report the practical result, not raw JSON.

## Rules for the developer-facing tool request

- Never guess mutation names or input fields when specifying the new tool.
- The new tool must validate before executing.
- Never build a tool that permits dangerous financial, staff, theme-live, gift card, or blocked mutations.
- Prefer narrow mutations that update only the requested fields.
- Include resource IDs only after safe lookup.

## Reporting (once a developer has added and shipped the tool)

After the new tool executes, say:

- what resource changed;
- what field/timeline entry/tag was updated;
- whether `userErrors` were returned;
- what manual action remains.

See `references/graphql-mutation-safety.md`.
