# PaintAccess Operations Desk Architecture

This document maps the target product to the current skill architecture. It is additive: existing cancellation, refund reminder, stock-delay, PO drafting, and skill-evolver flows remain part of the system.

## Product goal

PaintAccess Operations Desk coordinates:

```text
Shopify order
-> Purchase Order
-> Gmail supplier draft
-> supplier Sales Confirmation
-> price, quantity, shipping check
-> Shopify notes
-> Daniel payment approval
-> supplier processing
-> supplier tracking
-> Shopify fulfilment preparation
```

ChatGPT acts as the checking, preparation, and coordination centre.

## Approval policy

Require Daniel approval before:

- sending supplier/customer emails;
- approving or processing supplier payments;
- cancelling orders;
- issuing refunds;
- completing final Shopify fulfilment.

Allowed before approval:

- reading orders and emails;
- preparing drafts;
- comparing data;
- preparing notes;
- preparing fulfilment details;
- sending notifications that review/approval is needed.

## Skills map

| Product stage | Skills |
|---|---|
| New Shopify order review | `shopify-order-lookup-safe`, `supplier-po-automation`, `operations-stage-notifier` |
| Supplier split and PO preparation | `supplier-po-automation`, `shopify-order-note-recorder` |
| Supplier email draft | `gmail-draft-safe`, `operations-stage-notifier` |
| Supplier Sales Confirmation search | `gmail-message-finder-safe` |
| Sales Confirmation comparison | `supplier-sales-confirmation-checker`, `operations-stage-notifier` |
| Shopify order notes | `shopify-order-note-recorder`, `shopify-graphql-safe-mutation` |
| Payment approval | `supplier-payment-approval-recorder`, `operations-stage-notifier` |
| Tracking email search | `gmail-message-finder-safe` |
| Tracking and fulfilment preparation | `supplier-tracking-fulfillment-prep`, `shopify-order-note-recorder` |
| Customer messages | `customer-email-reply-drafter`, `shopify-stock-delay-customer-workflow`, `gmail-draft-safe` |
| Cancellation/refund reminder | `shopify-order-cancellation-reminder`, `shopify-order-note-recorder` |
| Product-level orchestration | `shopify-ops-orchestrator` |
| Skill improvement | `shopify-flow-skill-evolver` |
| Account/plugin setup | `paintaccess-integration-setup` |

## Notification stages

Operations Desk must notify at these key stages:

1. New order checked.
2. PO created and checked against quantities.
3. Supplier email draft prepared.
4. Supplier Sales Confirmation received.
5. Sales Confirmation checked against prices, quantities, and shipping.
6. Payment approval required.
7. Payment/order processed.
8. Tracking number received.
9. Shopify order updated and fulfilment prepared.

## Required integrations

- Shopify Admin: order read, product/variant read, order notes/tags/metafields, tracking/fulfilment preparation, GraphQL fallback.
- Gmail: drafts, search/read supplier Sales Confirmation emails, search/read tracking emails, optional send after Daniel approval.
- Google Drive: optional PO files, templates, or attachments.
- GitHub: maintain and deploy the existing backend repository `PaintSuccess/AiAgentFrontBack`.

## Recommended production surface

Use a shared ChatGPT Workspace Agent as the primary team/mobile interface.

See:

```text
automation/docs/workspace-agent-setup.md
automation/docs/shopify-operations-mcp-prd.md
```

Codex remains the development and maintenance surface for this repository. The Workspace Agent is the operational surface for the PaintAccess team.

## Google app connection outline

1. Daniel opens ChatGPT in the PaintAccess workspace.
2. Daniel connects Gmail from ChatGPT Apps using the correct Google account.
3. Daniel connects Google Drive from ChatGPT Apps only if PO templates/files/attachments are needed.
4. The Operations Desk uses Gmail/Drive through backend-authorized PaintAccess Operations MCP tools.
5. Do not store Google OAuth access or refresh tokens in this repository or backend by default.
6. Revoke access if needed from Google Account -> Security -> Third-party apps -> Remove Access and from ChatGPT app settings.

## Shopify app connection outline

1. Shopify Admin API credentials stay in Vercel/runtime secrets.
2. The custom MCP endpoint is `api/mcp/shopify.js`.
3. The ChatGPT workspace app is `PaintAccess Operations`.
4. The Operations Desk agent should use this app for Shopify lookups, order notes, tags, ops metafields, fulfilment preparation, and cancellation preparation.
