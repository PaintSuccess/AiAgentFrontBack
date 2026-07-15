# KB Docs — ElevenLabs Knowledge Base Local Mirror
Agent ID: agent_1001kn99pk1xefprh4gb665f6j3p
Last synced: 2026-07-15 16:05

Variant 3 refactor published to ElevenLabs: 2026-06-30 20:12

| File | ElevenLabs Doc ID | usage_mode |
|------|------------------|------------|
| Bot Behavior Rules.md | 7pHevm8qBA3TCyMkSt2P | prompt |
| Product Knowledge & Painting Guides.md | jzhZn0lbuIURjxAeVIDf | auto |
| Paint Sprayers Trouble-Shoot.md | kpbiVeRo1xUDHcx0WLNN | auto |
| Product Recommendation Rules.md | EQutE4iYTvz4lZPcYa9i | prompt |
| Product Recommendation Details.md | 8k7aHXxI2TAzsoLdui4x | auto |
| Excluded Products & Restrictions.md | YyJzX0Gm875wmW7KIv14 | prompt |
| Company Information.md | rVqMNfjLnuc0Q5qMydnB | prompt |
| Conversation & Estimation Logic paint calculation.md | 0K7kSe1CLkZrGZLFX2A8 | auto |

## Sync commands

### Pull all docs from ElevenLabs (run before editing any file here):
```powershell
cd "C:\Active Projects\Shopify-PaintAccess-Site\app"
.\kb-docs\sync-pull.ps1
```

### Push a single file back to ElevenLabs after editing:
Use the Knowledge Base editor in the Shopify admin dashboard (sidebar → Knowledge Base),
OR call the dashboard API: PATCH /api/dashboard/knowledge-base with { id, name, content, usage_mode }.

## usage_mode meanings
- **prompt** — document is always loaded into every conversation (injected into context)
- **auto** — document is retrieved on demand via RAG (semantic search when relevant)
