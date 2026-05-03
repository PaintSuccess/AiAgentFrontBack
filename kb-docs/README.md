# KB Docs — ElevenLabs Knowledge Base Local Mirror
Agent ID: agent_1001kn99pk1xefprh4gb665f6j3p
Last synced: 2026-05-03 16:05

| File | ElevenLabs Doc ID | usage_mode |
|------|------------------|------------|
| Bot Behavior Rules.md | nbb6fb64F7ZBvmro9Nsl | prompt |
| Product Knowledge & Painting Guides.md | EVajfWCHiLwFnKX5XwR0 | auto |
| Paint Sprayers Trouble-Shoot.md | aBEgdkiaVTYH16z8XwCn | auto |
| Product Recommendation Rules.md | p5jWk3wzcnKkKbVHylNc | auto |
| Excluded Products & Restrictions.md | iLprP0WEHUQH8rbxIqJG | prompt |
| Company Information.md | 6McwhoGGBfRItnfrFMqe | prompt |
| Conversation & Estimation Logic paint calculation.md | 71nlTO6VThpGJ3bZGyQN | auto |

## Sync commands

### Pull all docs from ElevenLabs (run before editing any file here):
```powershell
cd "C:\Active Projects\AiAgentFrontBack"
.\kb-docs\sync-pull.ps1
```

### Push a single file back to ElevenLabs after editing:
Use the Knowledge Base editor in the Shopify admin dashboard (sidebar → Knowledge Base),
OR call the dashboard API: PATCH /api/dashboard/knowledge-base with { id, name, content, usage_mode }.

## usage_mode meanings
- **prompt** — document is always loaded into every conversation (injected into context)
- **auto** — document is retrieved on demand via RAG (semantic search when relevant)
