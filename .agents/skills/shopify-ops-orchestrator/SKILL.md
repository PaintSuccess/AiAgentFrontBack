---
name: shopify-ops-orchestrator
description: coordinate repeatable paintaccess shopify operations by selecting and sequencing other shopify skills. use when a user asks for an end-to-end Operations Desk workflow involving new Shopify orders, order lookup, cancellation/refund reminders, stock-delay customer emails, gmail drafts, supplier purchase orders, supplier routing, sales confirmation checks, payment approval, tracking, fulfilment preparation, shopify notes/tags/metafields, notifications, or post-operation skill improvement.
---

# Shopify Ops Orchestrator

Use this skill as the router for PaintAccess Shopify operations.

## Primary rule

Do not perform risky Shopify changes until the target resource is identified with high confidence. Prefer a safe lookup step before any mutation.

## Routing

Use this sequence:

1. Classify the request:
   - order identification;
   - cancellation/refund reminder;
   - stock-delay customer communication;
   - customer reply drafting;
   - Gmail draft creation;
   - supplier PO automation;
   - supplier Sales Confirmation check;
   - payment approval/process recording;
   - supplier tracking and fulfilment preparation;
   - Shopify order note/status recording;
   - Operations Desk notification;
   - GraphQL mutation;
   - post-operation skill improvement.
2. Select the narrowest matching skill.
3. Chain skills in a safe order.
4. Confirm user intent before sensitive changes when required.
5. At the end of a repeatable operation, invoke the flow evolver logic.

## Common chains

### Cancel/refund reminder from email

1. `shopify-order-lookup-safe`
2. `shopify-order-cancellation-reminder`
3. `customer-email-reply-drafter` if a customer response is needed
4. `shopify-flow-skill-evolver`

### New order to supplier PO

1. `shopify-order-lookup-safe`
2. `supplier-po-automation`
3. `operations-stage-notifier` to report order reviewed and PO readiness
4. `gmail-draft-safe` if a supplier email draft or send step is requested
5. `shopify-order-note-recorder` to record PO sent/drafted status when applicable
6. `shopify-flow-skill-evolver`

### Supplier Sales Confirmation received

1. `gmail-message-finder-safe` to find the supplier confirmation email
2. `supplier-sales-confirmation-checker`
3. `operations-stage-notifier` to report match/mismatch, shipping, total, and issues
4. `shopify-order-note-recorder` to record confirmation details and payment status
5. `supplier-payment-approval-recorder` when Daniel approval or payment processing is needed
6. `shopify-flow-skill-evolver`

### Payment approval or supplier processing

1. `supplier-payment-approval-recorder`
2. `operations-stage-notifier` to request or confirm payment approval
3. `shopify-order-note-recorder` to record payment approved/processed and waiting for tracking
4. `shopify-flow-skill-evolver`

### Supplier tracking received

1. `gmail-message-finder-safe` to find the supplier tracking email
2. `supplier-tracking-fulfillment-prep`
3. `operations-stage-notifier` to report tracking received and fulfilment readiness
4. `shopify-order-note-recorder` to record carrier/tracking/fulfilment status
5. `shopify-flow-skill-evolver`

### Order stock delay customer email

1. `shopify-order-lookup-safe`
2. `shopify-stock-delay-customer-workflow`
3. `gmail-draft-safe` if a Gmail draft should be created
4. `shopify-order-note-recorder` to store the action and email copy
5. `shopify-flow-skill-evolver`

### Customer/supplier email copied into Shopify note

1. `shopify-order-lookup-safe`
2. `shopify-order-note-recorder`
3. `shopify-graphql-safe-mutation` if no dedicated order note tool exists
4. `shopify-flow-skill-evolver`

### Any Shopify write without a dedicated tool

1. `shopify-order-lookup-safe` or equivalent resource lookup
2. `shopify-graphql-safe-mutation`
3. `shopify-flow-skill-evolver`

## Safety constraints

- Never cancel, refund, delete, fulfill, or financially modify an order unless the user explicitly asks and the available tool allows it.
- Never send supplier/customer emails, approve/process supplier payments, or complete final fulfilment without Daniel's approval unless the rule is explicitly changed.
- If only a screenshot is provided and the order number is not visible, ask for the order number or another reliable identifier.
- For refunds/cancellations, prefer adding an internal reminder and giving manual Admin steps unless an approved tool safely supports the action.
- Do not invent supplier mappings. Use existing mappings or ask for confirmation.
- Do not claim a Gmail draft or Shopify note was created unless the relevant connector/tool confirms it.

See `references/flow-routing.md`.
See `references/operations-desk-lifecycle.md` for the full end-to-end product flow.
