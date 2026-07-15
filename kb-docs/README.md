# KB Docs — ElevenLabs Knowledge Base Local Mirror
Agent ID: agent_1001kn99pk1xefprh4gb665f6j3p
Last synced: 2026-07-15 16:12

Variant 3 refactor published to ElevenLabs: 2026-06-30 20:12

| File | ElevenLabs Doc ID | usage_mode |
|------|------------------|------------|
| Bot Behavior Rules.md | 27mB7NAv5hNjFfmhUe8C | prompt |
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
pwsh .\kb-docs\sync-pull.ps1
```
Use **pwsh (PowerShell 7+)**. Windows PowerShell 5.1 decodes the UTF-8 API responses as
Latin-1 and mangles every curly quote into mojibake ("can't" -> "canâ€™t"); the script now
refuses to run there rather than corrupt the mirror.

### Push a single file back to ElevenLabs after editing:
Use the Knowledge Base editor in the Shopify admin dashboard (sidebar → Knowledge Base),
OR call the dashboard API: PATCH /api/dashboard/knowledge-base with { id, name, content, usage_mode }.

**The doc id changes on every edit.** ElevenLabs text docs cannot be PATCHed, so an update
is really delete + recreate. Update the table above afterwards — a stale id here sends the
next person (or script) at a document that no longer exists.

## usage_mode meanings
- **prompt** — document is always loaded into every conversation (injected into context).
  Needs no RAG index.
- **auto** — document is retrieved on demand via RAG (semantic search when relevant).
  **Reachable ONLY via RAG: without an index it is permanently invisible to the agent.**

## ⚠ `auto` docs must be re-indexed after every change

Because an edit recreates the doc under a new id, the new doc has **no RAG index**. It will
be attached, look perfect in the editor, and never be retrieved — silently. No error, no
warning; the agent simply doesn't know the answer.

Found 2026-07-15: every doc had `{"indexes":[]}`, so ~61k chars — the entire DAN'S product
section, the 30k sprayer troubleshooting guide, the paint calculation logic — had never
been visible to the agent, while the always-loaded rules still said "use Product
Recommendation Details".

`api/dashboard/knowledge-base.js` now rebuilds the index automatically on create/update
(`ensureRagIndex`) and returns a `warning` if it fails. After any change made outside that
endpoint, verify by hand:

```powershell
cd "C:\Active Projects\Shopify-PaintAccess-Site\app\_store\setup"
node build-kb-rag-index.js --status    # every `auto` doc must say succeeded
node build-kb-rag-index.js --commit    # build any that are missing
```

Total `auto` content (~61k) already exceeds `rag.max_documents_length` (50,000), so RAG is
the only way in — an index is mandatory, not an optimisation.
