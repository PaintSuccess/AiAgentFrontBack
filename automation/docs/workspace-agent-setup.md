# PaintAccess Workspace Agent Setup

This guide describes the target setup for making PaintAccess Operations Desk available to the team from ChatGPT web/mobile with shared workflows, schedules, apps, and skills.

## Target outcome

Create a shared ChatGPT Workspace Agent:

```text
PaintAccess Operations Desk
```

The agent should help the team run:

- new Shopify order review;
- supplier split and PO preparation;
- supplier Gmail draft preparation;
- supplier Sales Confirmation checks;
- Shopify order timeline updates;
- payment approval coordination;
- supplier tracking checks;
- fulfilment preparation;
- stage notifications.

Sensitive actions should require Daniel approval unless explicitly changed later:

- sending emails;
- approving or processing payments;
- cancelling/refunding Shopify orders;
- completing final fulfilment.

## Prerequisites

- ChatGPT Business or Enterprise workspace.
- Workspace Agents enabled by workspace admin/owner.
- Required apps enabled in Workspace settings.
- Correct PaintAccess accounts available for authentication.
- The existing backend repository available in GitHub:

```text
https://github.com/PaintSuccess/AiAgentFrontBack
```

## Required tools/apps

Minimum:

- Gmail: backend-authorized PaintAccess Operations MCP tools for supplier/customer emails and supplier confirmations.
- Google Drive: backend-authorized PaintAccess Operations MCP tools for optional PO templates, attachments, generated PDFs/CSVs, and shared reference files.
- GitHub: maintain this automation repository.
- Shopify: workspace app `PaintAccess Operations`, backed by the custom MCP endpoint in this backend.

Important: do not put Gmail or Drive OAuth credentials into Git or agent instructions. Store Google OAuth values only in Vercel/runtime secrets. Shopify, Gmail, and Drive operational control now comes from the custom MCP because the generic/built-in apps do not expose the reliable actions PaintAccess needs.

Admin authorization helpers:

- Google Gmail/Drive: `https://ai-agent-front-back.vercel.app/api/google/oauth-start?pin=...`
- Shopify Admin API: `https://ai-agent-front-back.vercel.app/api/shopify/oauth-start`

The callback pages can auto-store refreshed tokens into Vercel when Vercel API/deploy-hook env vars are configured. If auto-store is not configured, the callback shows the token for manual Vercel entry.

## Recommended authentication model

Use this split:

- Gmail: Google OAuth credentials stored as Vercel/runtime secrets and exposed only through narrow MCP tools.
- Google Drive: Google OAuth credentials stored as Vercel/runtime secrets and exposed only through narrow MCP tools.
- Shopify: dedicated PaintAccess Shopify app/API credentials stored as Vercel/runtime secrets and exposed only through narrow MCP tools.

Use ChatGPT built-in Gmail/Drive Apps only as a temporary manual fallback if the backend Google OAuth is not configured.

## Setup steps

Use the YAML specs in `automation/workspace-agents/` as the source of intended configuration:

- `automation/workspace-agents/paintaccess-operations-desk.yaml`
- `automation/workspace-agents/paintaccess-admin-setup.yaml`
- `automation/workspace-agents/paintaccess-readonly-monitor.yaml`

The current public API can trigger published Workspace Agent runs, but the agent itself still needs to be created/configured in ChatGPT agent builder. See `automation/docs/workspace-agent-api-trigger.md`.

### 1. Enable Workspace Agents

Workspace admin:

1. Open ChatGPT workspace settings.
2. Enable Workspace Agents if not already enabled.
3. Confirm the target users/groups can create or use agents.

### 2. Enable apps

Workspace admin:

1. Open Workspace settings -> Apps.
2. Enable Gmail if available.
3. Enable Google Drive if Drive files/templates are needed.
4. Enable GitHub for repo maintenance if needed.
5. Enable the custom MCP app `PaintAccess Operations`.
6. Configure app action permissions and constraints.

Recommended constraints:

- Ask before sending emails.
- Ask before Shopify writes that affect customers, payment, cancellation, refund, or fulfilment.
- Allow low-risk draft/timeline-entry preparation where appropriate.

### 3. Create the agent

In ChatGPT:

1. Open Agents.
2. Select Create.
3. Name it:

```text
PaintAccess Operations Desk
```

4. Give it this purpose:

```text
Coordinate PaintAccess Shopify order operations: review new orders, prepare supplier POs, draft supplier/customer emails, check supplier confirmations, record Shopify order timeline entries, coordinate payment approval, process tracking details, and prepare fulfilment. Require Daniel approval for sending emails, payment approval/processing, cancellations/refunds, and final fulfilment.
```

### 4. Add skills

Add the skills from:

```text
.agents/skills/
```

Core skills to add first:

- `shopify-ops-orchestrator`
- `shopify-order-lookup-safe`
- `supplier-po-automation`
- `gmail-message-finder-safe`
- `gmail-draft-safe`
- `supplier-sales-confirmation-checker`
- `shopify-order-timeline-recorder`
- `supplier-payment-approval-recorder`
- `supplier-tracking-fulfillment-prep`
- `operations-stage-notifier`
- `paintaccess-integration-setup`

Add supporting skills as well:

- `customer-email-reply-drafter`
- `shopify-stock-delay-customer-workflow`
- `shopify-order-cancellation-reminder`
- `shopify-graphql-safe-mutation`
- `shopify-flow-skill-evolver`

### 5. Add files

Add these project files as agent context:

- `README.md`
- `automation/README.md`
- `automation/docs/operations-desk-architecture.md`
- `automation/docs/client-connector-onboarding.md`
- `automation/docs/workspace-agent-setup.md`
- source chat summaries if useful:
  - `automation/chats/shopify-chat-summary-2026-06-20.md`
  - `automation/chats/shopify_automation_chat_summary.md`
  - `automation/chats/shopify_po_flow_summary.md`

### 6. Add apps/tools to the agent

Add:

- Custom MCP app `PaintAccess Operations`.

### 7. Configure app authentication

Choose per app:

- End-user account: each person uses their own account.
- Workspace/custom MCP: backend credentials are stored in Vercel/runtime secrets.

Recommended for PaintAccess:

- Shopify uses the workspace MCP app and backend Shopify token.
- Gmail and Google Drive use the same workspace MCP app and backend Google OAuth token.
- Do not store Google OAuth tokens in this repository or agent instructions.
- After Shopify app scopes change, reauthorize via `/api/shopify/oauth-start` so `SHOPIFY_ACCESS_TOKEN` receives the new scopes.

### 8. Configure schedules

Suggested schedules:

```text
Weekdays 8:30 AM: Check new Shopify orders and prepare order review report.
Weekdays 11:30 AM: Check supplier Sales Confirmations and tracking emails.
Weekdays 3:30 PM: Check unresolved payment approvals, supplier confirmations, and tracking.
```

Each scheduled run should produce a short report:

```text
Stage: {stage}
Orders checked: {count}
Actions prepared: {summary}
Approvals needed: {list}
Issues: {list_or_none}
Next action: {recommended_action}
```

### 9. Test safely

Start with read-only tests:

1. Find a known Shopify order.
2. Find a known supplier email.
3. Draft a supplier PO email without sending.
4. Prepare a Shopify order timeline entry without writing it.

Then test low-risk writes:

1. Create a Gmail draft.
2. Record a non-financial Shopify order timeline entry.

Do not test live sending, refund, cancellation, payment, or final fulfilment until Daniel approves the exact behavior.

## Custom MCP/backend recommendation

For the production Operations Desk, use the custom MCP/backend for Shopify, Gmail, and Drive.

The Shopify MCP exposes narrow tools:

- `shopify_get_order`
- `shopify_search_orders`
- `shopify_get_fulfillment_readiness`
- `shopify_record_order_timeline_entry`
- `shopify_remove_order_note_entry`
- `shopify_add_order_tag`
- `shopify_remove_order_tag`
- `shopify_set_ops_metafield`
- `shopify_prepare_fulfillment`
- `shopify_prepare_cancellation`
- `shopify_prepare_customer_email`
- `shopify_send_customer_email`
- `gmail_search_messages`
- `gmail_get_message`
- `gmail_create_draft`
- `gmail_send_email`
- `drive_search_files`
- `drive_get_file`
- `drive_create_text_file`

Avoid broad tools such as arbitrary GraphQL mutation, arbitrary Gmail send, or live admin-panel control unless protected with strong approval and constraints.

## Mobile usage

Team members use the agent from ChatGPT mobile:

1. Open ChatGPT mobile.
2. Open Agents.
3. Select PaintAccess Operations Desk.
4. Ask operational requests such as:

```text
Check new orders and tell me which ones are ready for PO.
```

```text
Find the Sales Confirmation for order #44478 and compare it with the PO.
```

```text
Check if tracking arrived for today's supplier orders.
```

Scheduled reports appear in the agent/scheduled run experience and can also send notifications depending on workspace/mobile notification settings.
