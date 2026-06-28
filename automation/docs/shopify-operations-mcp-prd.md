# PaintAccess Operations MCP PRD

## Document status

- Status: Phase 1 implementation started
- Owner: PaintAccess / Combotask
- Primary surface: ChatGPT Workspace Agent
- Supporting surface: Existing PaintAccess Vercel backend
- Related project: `C:\Active Projects\Shopify-PaintAccess-Site\app`
- Related automation source: `C:\Active Projects\Shopify-PaintAccess-Site\app\automation`

## Summary

PaintAccess needs a ChatGPT-based Operations Desk that can coordinate Shopify order operations, supplier purchase orders, Gmail drafts/sends, Google Drive files, customer communication, internal notes, payment approvals, supplier tracking, and fulfilment preparation.

User testing showed that ChatGPT's built-in Gmail and Google Drive app authorizations were unreliable for this agent workflow. Gmail and Google Drive should now be handled by the PaintAccess backend and exposed through the same custom MCP as Shopify.

This PRD defines a custom PaintAccess Operations MCP that exposes narrow, safe Shopify, Gmail, and Google Drive operational tools to ChatGPT Workspace Agents. The MCP is backed by the existing PaintAccess backend, using Shopify Admin credentials and Google OAuth credentials stored only in backend/runtime secrets.

## Problem

PaintAccess has two connected systems:

1. A public AI website widget and voice/chat backend.
2. An internal Operations Desk workflow for staff and client-side admin work.

The public widget backend already supports safe product search, inventory, lead capture, order status lookup, communication logs, WhatsApp, Twilio, and dashboard APIs. Those endpoints are intentionally customer-safe and do not expose broad Shopify admin power.

The Operations Desk requires staff-grade Shopify actions:

- read new and existing orders;
- inspect customer/order context;
- identify supplier routing;
- prepare supplier purchase orders;
- record process status on Shopify orders;
- add internal notes and tags;
- avoid duplicate supplier PO sends;
- prepare fulfilment details;
- support approval-gated cancellation/refund/payment workflows;
- provide read-only monitoring and scheduled status reports.

The built-in Shopify ChatGPT app does not expose enough write/control operations for this workflow. Browser-based admin control is fragile and should not be the production strategy. Raw CLI access is also too broad and unsuitable for operational agents.

## Goals

1. Enable ChatGPT Workspace Agents to perform safe Shopify operations through narrow tools.
2. Keep Gmail and Google Drive handled by backend OAuth tools in the PaintAccess Operations MCP.
3. Store Shopify credentials only in approved backend secret storage.
4. Preserve the skill-based Operations Desk model now merged into the existing backend repository.
5. Require Daniel/client approval before sensitive actions.
6. Make every Shopify write auditable.
7. Prevent duplicate supplier PO processing.
8. Separate public customer widget endpoints from internal staff/admin operations.
9. Support both interactive requests and scheduled Workspace Agent reports.

## Non-goals

1. Do not rely on ChatGPT built-in Gmail or Google Drive apps as the production path.
2. Do not expose arbitrary Shopify CLI execution to agents.
3. Do not expose arbitrary GraphQL mutation execution to normal Operations Desk users.
4. Do not rely on browser automation for Shopify Admin production workflows.
5. Do not attempt to control every Shopify Admin setting through ChatGPT.
6. Do not perform refunds, cancellations, payments, or final fulfilment without explicit approval.
7. Do not store Gmail, Drive, Shopify, or ChatGPT tokens in Git.

## Users

### Daniel / PaintAccess owner

Needs to review, approve, and control sensitive business actions such as sending supplier emails, approving payments, cancelling orders, issuing refunds, and completing fulfilment.

### Operations staff

Need to check orders, prepare POs, draft supplier/customer communication, review supplier confirmations, and know what requires approval.

### Read-only monitor users

Need visibility into new orders, blocked orders, supplier confirmation status, payment approval status, and tracking readiness without write access.

### Admin/setup user

Maintains Workspace Agent setup, skills, custom MCPs, app authorizations, schedules, and rollout checklists.

## Existing system context

### Main app

The main app lives in:

```text
C:\Active Projects\Shopify-PaintAccess-Site\app
```

Current stack:

- React 18 and Shopify Polaris dashboard.
- Vite frontend.
- Vercel serverless backend under `api/`.
- CommonJS backend helpers under `lib/`.
- Shopify Admin API helper in `lib/shopify.js`.
- Dashboard auth helper in `lib/dashboard-auth.js`.
- Public AI agent tools configured under `_store/setup/create-tools.js`.

Existing Shopify-related endpoints:

- `api/shopify/products.js` - product search for AI widget.
- `api/shopify/inventory.js` - availability checks.
- `api/shopify/order.js` - customer-safe order lookup requiring order number and email.
- `api/shopify/customer.js` - guarded public lead/customer creation.

These endpoints are not sufficient for internal staff operations because they intentionally avoid broad admin writes.

### Automation project

The automation source lives in:

```text
C:\Active Projects\Shopify-PaintAccess-Site\app\automation
```

Important documents:

- `docs/operations-desk-architecture.md`
- `docs/workspace-agent-setup.md`
- `docs/workspace-agent-api-trigger.md`
- `docs/client-connector-onboarding.md`

Important agent specs:

- `automation/workspace-agents/paintaccess-operations-desk.yaml`
- `automation/workspace-agents/paintaccess-readonly-monitor.yaml`
- `automation/workspace-agents/paintaccess-admin-setup.yaml`

Important skills:

- `shopify-ops-orchestrator`
- `shopify-order-lookup-safe`
- `supplier-po-automation`
- `gmail-message-finder-safe`
- `gmail-draft-safe`
- `supplier-sales-confirmation-checker`
- `shopify-order-note-recorder`
- `supplier-payment-approval-recorder`
- `supplier-tracking-fulfillment-prep`
- `operations-stage-notifier`
- `paintaccess-integration-setup`

## Product decision

Use this hybrid architecture:

```text
ChatGPT Workspace Agent
  -> PaintAccess Operations MCP
      -> PaintAccess backend
          -> Shopify Admin GraphQL/API
          -> Gmail API
          -> Google Drive API
          -> audit log
          -> approval state
```

Shopify, Gmail, and Google Drive operational access are provided by the custom PaintAccess Operations MCP because the built-in ChatGPT apps did not expose the required reliable operational control.

## ChatGPT agent model

### PaintAccess Operations Desk

Primary interactive operating agent.

Allowed:

- read orders;
- prepare PO summaries;
- use backend Gmail tools to search/read emails;
- use backend Gmail tools to draft/send emails after approval;
- use backend Google Drive tools to read/write PO files if authorized;
- add safe Shopify internal notes and tags through MCP;
- prepare fulfilment details without final completion;
- produce approval requests for Daniel.

Requires approval:

- sending customer or supplier emails;
- cancelling Shopify orders;
- issuing refunds;
- approving or processing payments;
- completing final Shopify fulfilment;
- changing high-impact product/customer/order data.

### PaintAccess Read-only Monitor

Visibility-only agent.

Allowed:

- read orders and status;
- read Gmail messages if app access permits;
- inspect Drive files if app access permits;
- produce reports.

Forbidden:

- Shopify writes;
- Gmail drafts/sends;
- Drive writes;
- payment/cancellation/refund/fulfilment actions.

### PaintAccess Admin Setup

Private setup and maintenance agent.

Allowed:

- guide connector setup;
- compare live agent configuration against repo specs;
- recommend MCP tool changes;
- maintain rollout checklists.

Forbidden without explicit admin approval:

- changing production app credentials;
- publishing agents;
- revoking access;
- changing action permissions;
- performing live order operations.

## Functional requirements

### FR1: Order lookup

The MCP must allow staff agents to find Shopify orders by:

- order name/number, such as `#44478`;
- Shopify order GID;
- customer email;
- customer name;
- date range;
- fulfilment status;
- financial status;
- tags or process state.

The result must return enough data for staff operations but should avoid unnecessary sensitive details.

Minimum response:

- order ID/GID;
- order name;
- created date;
- customer name and email;
- line items;
- SKU;
- vendor;
- quantity;
- shipping address when needed for supplier PO;
- financial status;
- fulfilment status;
- tags;
- note summary/process state;
- existing fulfilments/tracking.

### FR2: Safe order identity

Before any write, the MCP caller must provide a high-confidence order identifier:

- Shopify GID; or
- exact order number with a unique lookup result.

The MCP must reject writes when the order is ambiguous.

### FR3: Internal order notes

The MCP must support adding or updating internal order notes for operational events:

- PO drafted;
- PO sent;
- supplier confirmation received;
- confirmation mismatch found;
- payment approval required;
- payment approved;
- tracking received;
- fulfilment prepared;
- cancellation/refund reminder;
- customer stock delay communication;
- manual action required.

The note must include:

- timestamp;
- action;
- actor/tool;
- source;
- order number;
- supplier if applicable;
- next action;
- approval state where applicable.

### FR4: Order tags

The MCP must support adding and removing controlled process tags.

Initial controlled tag set:

- `PO draft prepared`
- `PO sent`
- `PO sent - {Supplier}`
- `Sales Confirmation checked`
- `Sales Confirmation mismatch`
- `Payment approval required`
- `Payment approved`
- `Payment processed`
- `Tracking received`
- `Fulfilment prepared`
- `Customer emailed - stock delay`
- `Awaiting customer confirmation`
- `Manual action required`

The MCP must not allow arbitrary tags in phase 1 unless admin-enabled.

### FR5: Supplier workflow state

The MCP should support reading and writing supplier process state through tags, notes, or metafields.

Preferred long-term state storage:

```text
namespace: paintaccess_ops
keys:
  po_status
  po_suppliers
  supplier_confirmation_status
  payment_status
  tracking_status
  fulfilment_prep_status
  last_agent_action
```

Phase 1 may use notes and tags only if metafield implementation is deferred.

### FR6: Duplicate prevention

Before recording `PO sent` or preparing a duplicate supplier email, the MCP must check existing tags/metafields/notes for matching supplier state.

If duplicate risk is detected, the tool must return:

- `duplicate_risk: true`;
- existing marker;
- recommended next action;
- no write performed unless an override tool with approval is used.

### FR7: Fulfilment preparation

The MCP must support preparing fulfilment information without completing final fulfilment.

Allowed phase 1 behavior:

- read fulfilment orders;
- inspect fulfilment readiness;
- prepare carrier/tracking data payload;
- produce a human-readable fulfilment preview;
- add `Fulfilment prepared` note/tag after approval or clear instruction.

Forbidden phase 1 behavior:

- final fulfilment completion without Daniel approval;
- sending customer fulfilment notification without approval.

### FR8: Cancellation/refund preparation

The MCP may support cancellation/refund preparation but must not execute cancellations/refunds in phase 1.

Allowed:

- check order status;
- verify paid/unfulfilled state;
- prepare internal note;
- prepare customer reply;
- mark `Manual action required`;
- report manual Shopify Admin steps.

Forbidden phase 1:

- executing refund;
- executing cancellation;
- deleting order.

### FR9: Gmail integration via backend MCP

Gmail must be handled by backend-authorized MCP tools in the PaintAccess Operations MCP.

The MCP must not store Gmail credentials in Git. Google OAuth credentials must be stored only in Vercel/runtime secrets.

The Operations Desk skills should instruct the agent to use MCP actions for:

- supplier email search;
- supplier Sales Confirmation search;
- tracking email search;
- Gmail draft creation;
- email send only after approval where the app supports confirmation.

When a Gmail action is completed, the agent should record the result in Shopify through the Shopify MCP tools when appropriate.

### FR10: Google Drive integration via backend MCP

Google Drive must be handled by backend-authorized MCP tools in the PaintAccess Operations MCP.

Use Drive for:

- PO templates;
- generated PO docs;
- supplier attachment files;
- shared operations checklists.

The MCP must not store Drive credentials in Git. Google OAuth credentials must be stored only in Vercel/runtime secrets.

### FR11: Agent reports

The system must support concise reports grouped by:

- needs attention now;
- waiting on Daniel;
- waiting on supplier;
- ready for next stage;
- mismatches/blockers;
- completed since last check.

Reports must include:

- order number;
- supplier;
- current stage;
- blocker;
- recommended next action.

### FR12: Scheduled runs

Workspace Agent schedules should use the same tools and skills.

Suggested schedules:

- weekday morning order review;
- midday supplier confirmation/tracking check;
- afternoon unresolved operations sweep.

Scheduled runs should default to read-only or draft/prep actions unless explicitly configured otherwise.

## MCP tool requirements

### Tool group 1: Read-only Shopify tools

#### `shopify_search_orders`

Purpose: Find candidate orders.

Inputs:

- `query`
- `order_number`
- `customer_email`
- `customer_name`
- `created_at_min`
- `created_at_max`
- `financial_status`
- `fulfillment_status`
- `tag`
- `limit`

Output:

- list of compact order summaries;
- confidence hints;
- whether exact match exists.

#### `shopify_get_order`

Purpose: Get full staff operational order detail.

Inputs:

- `order_id` or `order_number`

Output:

- order details;
- line items;
- shipping details;
- tags;
- notes/process state;
- fulfilment state;
- existing tracking.

#### `shopify_get_fulfillment_readiness`

Purpose: Inspect fulfilment order status and determine whether fulfilment can be prepared.

Inputs:

- `order_id`

Output:

- fulfilment orders;
- locations;
- line items;
- status;
- warnings;
- possible next action.

### Tool group 2: Safe write tools

#### `shopify_add_order_note`

Purpose: Add a controlled internal order note.

Inputs:

- `order_id`
- `note_type`
- `summary`
- `source`
- `supplier`
- `next_action`
- `copy_text`
- `approval_reference`

Output:

- success/failure;
- updated note preview;
- user errors.

#### `shopify_remove_order_note_entry`

Purpose: Remove the latest matching PaintAccess Operations note entry when correcting or reverting an agent-added note.

Inputs:

- `order_id`
- `note_type`
- `summary_contains`
- `reason`

Output:

- success/failure;
- removed entry preview;
- user errors.

#### `shopify_add_order_tag`

Purpose: Add a controlled process tag.

Inputs:

- `order_id`
- `tag`
- `supplier`
- `reason`

Output:

- success/failure;
- resulting tags.

#### `shopify_remove_order_tag`

Purpose: Remove a controlled process tag when correcting workflow state.

Inputs:

- `order_id`
- `tag`
- `reason`

Output:

- success/failure;
- resulting tags.

#### `shopify_set_ops_metafield`

Purpose: Write controlled Operations Desk state.

Inputs:

- `order_id`
- `key`
- `value`
- `reason`

Output:

- success/failure;
- resulting state.

Phase: optional in phase 1, recommended in phase 2.

### Tool group 3: Preparation tools

#### `shopify_prepare_fulfillment`

Purpose: Validate and preview fulfilment/tracking payload without final completion.

Inputs:

- `order_id`
- `tracking_number`
- `tracking_company`
- `tracking_url`
- `line_items`
- `notify_customer`

Output:

- fulfilment preview;
- validation warnings;
- approval required flag.

#### `shopify_prepare_cancellation`

Purpose: Produce a cancellation/refund readiness report.

Inputs:

- `order_id`
- `reason`
- `customer_request_source`

Output:

- current status;
- eligibility hints;
- manual action steps;
- suggested note;
- approval required flag.

### Tool group 4: Admin-only diagnostic tools

#### `shopify_validate_graphql_operation`

Purpose: Validate a proposed Shopify GraphQL operation in admin/testing mode.

Availability:

- Admin Setup agent only.

#### `shopify_execute_approved_graphql_operation`

Purpose: Execute a pre-approved narrow GraphQL operation.

Availability:

- Admin Setup agent only.
- Requires explicit approval and audit reason.

This must not be exposed to normal Operations Desk in phase 1.

## Backend API shape

The MCP may call internal backend endpoints such as:

```text
POST /api/ops/shopify/search-orders
POST /api/ops/shopify/get-order
POST /api/ops/shopify/add-order-note
POST /api/ops/shopify/add-order-tag
POST /api/ops/shopify/remove-order-tag
POST /api/ops/shopify/set-ops-metafield
POST /api/ops/shopify/get-fulfillment-readiness
POST /api/ops/shopify/prepare-fulfillment
POST /api/ops/shopify/prepare-cancellation
```

These must be separate from public widget endpoints under `api/shopify/`.

## Authentication and authorization

### Backend secrets

Store in Vercel or another approved secret store:

- Shopify store domain;
- Shopify Admin access token;
- MCP/backend signing secret;
- optional audit log destination credentials.

Do not store:

- Gmail OAuth tokens;
- Google Drive OAuth tokens;
- ChatGPT connector auth state;
- Shopify admin passwords;
- staff passwords;
- recovery codes;
- `.env` files with real values.

### MCP request auth

The MCP/backend must verify that requests come from the approved ChatGPT custom connector or trusted runtime.

At minimum:

- bearer token or signed request secret;
- tool-level authorization;
- environment-specific secrets;
- no anonymous access.

Preferred:

- OAuth-based MCP app auth where supported;
- role/scoped claims for Operations Desk, Read-only Monitor, and Admin Setup.

### Tool scopes

Tool access should be grouped:

```text
readonly:
  - shopify_search_orders
  - shopify_get_order
  - shopify_get_fulfillment_readiness

safe_write:
  - shopify_add_order_note
  - shopify_add_order_tag
  - shopify_remove_order_tag
  - shopify_set_ops_metafield

prepare_sensitive:
  - shopify_prepare_fulfillment
  - shopify_prepare_cancellation

admin_only:
  - shopify_validate_graphql_operation
  - shopify_execute_approved_graphql_operation
```

## Approval model

### No approval required

- read order;
- search orders;
- read fulfilment readiness;
- prepare PO text;
- prepare customer/supplier email text;
- create Gmail draft if client policy allows drafts;
- add non-financial internal note after explicit user instruction;
- add controlled process tag after explicit user instruction.

### Daniel approval required

- send supplier/customer emails;
- approve/process supplier payment;
- complete final fulfilment;
- notify customer of fulfilment;
- cancel an order;
- issue a refund;
- change high-impact order/customer/product data;
- override duplicate prevention.

### Admin approval required

- changing MCP scopes;
- enabling arbitrary GraphQL execution;
- changing Shopify app token/scopes;
- changing agent publishing/access;
- connecting a new production store.

## Audit requirements

Every Shopify write must produce an audit record.

Minimum audit fields:

- timestamp;
- tool name;
- actor/agent name if available;
- order ID;
- order number;
- action;
- before/after where practical;
- approval reference if required;
- result;
- user errors;
- request correlation ID.

Phase 1 audit targets:

- application logs;
- Shopify order note for business-relevant state.

Phase 2 audit targets:

- durable database table;
- admin dashboard audit view;
- optional export to Google Sheet/Drive.

## Data model

### Order process state

Recommended eventual shape:

```json
{
  "order_id": "gid://shopify/Order/...",
  "order_name": "#44478",
  "po_status": "draft_prepared | sent | blocked | not_required",
  "suppliers": [
    {
      "name": "IQuip",
      "status": "draft_prepared | sent | confirmed | mismatch | tracking_received",
      "po_reference": "PO-44478-IQUIP",
      "gmail_thread_hint": "...",
      "drive_file_hint": "..."
    }
  ],
  "payment_status": "not_required | approval_required | approved | processed",
  "tracking_status": "missing | received | prepared_for_fulfillment",
  "fulfillment_status": "not_ready | prepared | completed",
  "last_agent_action": "..."
}
```

### Supplier mapping

Supplier mapping must be explicit and maintainable.

Fields:

- supplier name;
- supplier email/contact rule;
- match type: vendor, SKU prefix, tag, product type, metafield, manual override;
- SKU transformation rule;
- PO template;
- email template;
- payment terms/notes;
- special handling rules.

Supplier mapping should not be inferred purely from product name unless an explicit rule exists.

## Shopify API considerations

Use Shopify Admin GraphQL/API directly from backend code rather than invoking Shopify CLI for production operations.

The existing `lib/shopify.js` helper currently calls Shopify Admin API version `2024-10`. Before implementation, evaluate upgrading the internal operations layer to a current supported Admin API version and prefer GraphQL for new write workflows.

Required Shopify app scopes will depend on final tools, but likely include:

- read orders;
- write orders or order editing-related permissions where applicable;
- read products;
- read inventory;
- read fulfilment orders;
- write fulfilment where final fulfilment is later enabled;
- read/write metafields if using operation state metafields.

Exact scopes must be confirmed during implementation against the Shopify Admin API operations used.

## UX requirements inside ChatGPT

The agent should respond in operational language:

- concise;
- action-oriented;
- grouped by order/supplier/stage;
- explicit about what was actually done versus prepared;
- explicit when approval is required;
- never claim a Shopify/Gmail/Drive action succeeded unless the tool confirms it.

Example successful response:

```text
Order #44478 checked.

PO draft prepared for IQuip:
- 38EWS x1
- 38EHB60 x1

Gmail draft prepared via PaintAccess Operations MCP.
Shopify note added: PO draft prepared, waiting for Daniel approval to send.

Approval needed: send supplier email.
```

Example duplicate warning:

```text
Order #44478 already has `PO sent - IQuip`.

I did not create another supplier draft. Please confirm if this is a resend or correction.
```

## Error handling

The MCP/backend must return safe, practical errors.

Examples:

- `order_not_found`
- `ambiguous_order`
- `duplicate_risk`
- `approval_required`
- `shopify_scope_missing`
- `shopify_user_error`
- `rate_limited`
- `invalid_controlled_tag`
- `unsafe_action_blocked`

Agents should translate errors into next steps, not expose raw stack traces.

## Rollout plan

### Phase 0: PRD and design confirmation

Deliverables:

- this PRD;
- implementation checklist;
- confirmed tool list;
- confirmed approval policy;
- confirmed Shopify scopes.

### Phase 1: Read-only Shopify MCP

Deliverables:

- `shopify_search_orders`;
- `shopify_get_order`;
- `shopify_get_fulfillment_readiness`;
- Operations Desk can inspect orders;
- Read-only Monitor can produce reports.

Acceptance:

- known orders can be found;
- ambiguous searches are handled safely;
- no writes are possible through read-only tools.

### Phase 2: Safe writes

Deliverables:

- `shopify_add_order_note`;
- `shopify_add_order_tag`;
- controlled tag validation;
- audit logging;
- duplicate prevention for PO markers.

Acceptance:

- note can be added to a test order;
- controlled tag can be added to a test order;
- duplicate PO marker blocks repeat processing;
- all writes show an audit record.

### Phase 3: Operations workflow integration

Deliverables:

- agent skill updates if needed;
- end-to-end order to PO draft workflow;
- Gmail MCP draft plus Shopify note/tag coordination;
- supplier confirmation check workflow;
- tracking received workflow.

Acceptance:

- agent can process a known order through PO draft status;
- agent can record Gmail draft result in Shopify;
- agent can identify missing approvals.

### Phase 4: Fulfilment preparation

Deliverables:

- fulfilment readiness;
- prepare fulfilment payload;
- Shopify note/tag for fulfilment prepared;
- Daniel approval gate.

Acceptance:

- tracking details can be validated;
- fulfilment payload preview is correct;
- final fulfilment is not completed without approval.

### Phase 5: Sensitive operations preparation

Deliverables:

- cancellation/refund preparation report;
- internal reminder notes;
- approval references;
- manual handoff instructions.

Acceptance:

- agent can prepare but not execute cancellation/refund;
- note and tag accurately reflect manual action required.

## Acceptance criteria

The implementation is successful when:

1. ChatGPT Operations Desk can use one PaintAccess Operations MCP for Shopify, Gmail, and Drive workflows.
2. The backend stores Gmail/Drive credentials only in approved runtime secrets, never in Git.
3. Shopify writes are limited to approved narrow tools.
4. Read-only Monitor cannot write.
5. Sensitive actions require Daniel approval.
6. Duplicate supplier PO processing is detected and blocked.
7. Every Shopify write is auditable.
8. The system can run from ChatGPT web/mobile without Codex or a local project folder.
9. Runtime credentials are never committed to Git.

## Risks

### Backend Google OAuth limitations

Backend Google OAuth may be missing scopes, revoked, or blocked by Google account policy.

Mitigation:

- expose explicit missing-configuration errors from MCP tools;
- keep Gmail send approval-gated;
- document revocation and reauthorization steps.

### Shopify plugin limitations

The built-in Shopify ChatGPT app may remain too limited.

Mitigation:

- use custom Shopify MCP for operational tools.

### Shopify Admin API coverage

Some Shopify Admin UI settings and Shopify Inbox features may not be exposed through public APIs.

Mitigation:

- only promise API-backed actions;
- use manual admin steps or admin setup guidance for unsupported UI-only areas;
- avoid production browser automation.

### Over-broad agent power

Agents with broad GraphQL or CLI access could damage orders, customer records, or fulfilment state.

Mitigation:

- narrow tools;
- controlled tags;
- approval gates;
- audit logs;
- no arbitrary CLI/GraphQL in normal Operations Desk.

### Missing supplier mapping

Without explicit supplier rules, PO automation may route incorrectly.

Mitigation:

- build supplier mapping table before automatic sends;
- require confirmation for unknown suppliers.

## Open questions

1. Which Shopify writes are allowed without Daniel approval: notes only, tags only, metafields, or all three?
2. Should operation state use only notes/tags in phase 1, or should metafields be implemented immediately?
3. Which supplier mappings are authoritative today?
4. Should Gmail draft creation require approval, or only Gmail send?
5. Should final fulfilment ever be agent-executable after approval, or always manual?
6. Should the MCP support staff-level identity, or use one shared PaintAccess Shopify app identity?
7. Is Shopify Inbox required for phase 1, or can customer communication remain in Gmail/WhatsApp/widget channels?

## Implementation checklist

- Confirm Shopify app scopes.
- Decide MCP hosting path. Initial path: `https://ai-agent-front-back.vercel.app/api/mcp/shopify?token={SHOPIFY_MCP_TOKEN}`.
- Define MCP auth mechanism. Initial private rollout uses `SHOPIFY_MCP_TOKEN`; production hardening should move to OAuth.
- Create `/api/ops/shopify/*` backend namespace. Initial implementation exposes operations through `/api/mcp/shopify`.
- Add read-only tools.
- Add controlled write tools.
- Add audit logging.
- Add duplicate prevention.
- Add Workspace Agent tool descriptions.
- Test with known historical orders.
- Test Read-only Monitor cannot write.
- Test Operations Desk note/tag write on a safe order.
- Test Gmail MCP draft plus Shopify note workflow.
- Document production runbook.
