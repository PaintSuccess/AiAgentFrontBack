# PaintAccess Operations Automation

The existing PaintAccess backend repository is the source of truth for the AI website widget, Shopify backend, Operations Desk MCP, Workspace Agent specs, skills, workflow notes, and reusable operational procedures.

## Purpose

The project collects repeatable Shopify operations into Skills so similar tasks can be performed with higher stability, safety, and quality.

Current focus:

- safe Shopify order lookup;
- cancellation/refund reminder timeline entries;
- safe Shopify GraphQL mutations;
- supplier purchase order automation;
- supplier Sales Confirmation checking;
- payment approval coordination;
- supplier tracking and fulfilment preparation;
- stage notifications for Operations Desk;
- customer email drafting;
- orchestration between operational skills;
- post-operation flow capture and skill improvement.

## Structure

```text
.agents/
  skills/
    PaintAccess repo-scoped skills loaded from the app repository root.

automation/
  docs/
  workspace-agents/
  scripts/
  chats/
  shopify-chat-summary-2026-06-20.md
  Additional source summaries:
    shopify_automation_chat_summary.md
    shopify_po_flow_summary.md

api/mcp/shopify.js
  ChatGPT MCP endpoint for Shopify operations.

lib/shopify-ops.js
  Shopify Admin GraphQL operations layer used by the MCP endpoint.
```

## Operating model

ChatGPT Web can execute Shopify/Gmail-style operations and produce working observations.

This repository stores durable process knowledge.

Skills live in the app repo root at `.agents/skills/`.

Codex scans `.agents/skills/` when the repository is opened, so users who pull the repository can use the skills without manually installing them into their personal skill folder.

After editing skills, run:

```powershell
.\automation\scripts\validate_repo_skills.ps1
```

Then commit and push the validated changes.

Do not update skills just because a task happened. Update only when the new information improves stability, speed, safety, or output quality.

## Target product

PaintAccess Operations Desk coordinates the full order workflow:

```text
Shopify order
-> order review and supplier split
-> Purchase Order preparation
-> Gmail supplier draft
-> supplier Sales Confirmation check
-> Shopify order timeline entry
-> Daniel payment approval
-> supplier processing
-> tracking email
-> Shopify tracking/fulfilment preparation
```

Sensitive actions require Daniel's approval unless the operating rules are changed later: sending emails, approving payments, cancelling/refunding orders, and completing final fulfilment.

The Shopify Operations MCP implementation contract is documented in:

```text
automation/docs/shopify-operations-mcp-prd.md
```
