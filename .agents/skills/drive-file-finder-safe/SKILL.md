---
name: drive-file-finder-safe
description: safely find PaintAccess Google Drive files for Shopify order workflows. use when looking for PO files, supplier attachments, order documents, generated text files, shared Drive records, or Drive files related to an order number, customer, supplier, confirmation, tracking, or purchase order. prefer separate narrow Drive searches instead of broad OR queries.
---

# Drive File Finder Safe

Use this skill before reading or creating Google Drive files for order workflows.

## Connector rule

Use Google Drive through the PaintAccess Operations MCP backend tools: `drive_search_files` and `drive_get_file`. Use `drive_create_text_file` only when the user explicitly asks to create a Drive file and the content is ready.

Do not ask for Google passwords, OAuth client secrets, access tokens, or refresh tokens. If backend Google credentials are not configured, return the exact Drive search terms to run manually and state that no Drive file was read or created.

## Core rules

- Start with exact identifiers, especially the numeric order number without `#`.
- Do not use a combined Drive query such as `#44542 OR 44542`.
- Run separate narrow searches for each useful identifier.
- Treat zero matches as a valid result, not an authorization failure.
- Do not create, delete, rename, move, or share Drive files from this skill.
- Do not claim a Drive file exists unless `drive_search_files` or `drive_get_file` confirms it.

## Workflow

1. Build a small search plan from available identifiers:
   - numeric order number, e.g. `44542`;
   - Shopify order name, e.g. `#44542`;
   - customer email or name;
   - supplier name;
   - PO number or subject;
   - confirmation/tracking number.
2. Search one identifier at a time with `drive_search_files`.
3. If the MCP supports `name_contains`, prefer it for exact order numbers and PO numbers.
4. If a query string is needed, keep it simple and literal:
   - `44542`;
   - `PO 44542`;
   - `{supplier} 44542`;
   - `{customer_email}`;
   - `{tracking_number}`.
5. Summarize candidate files by name, type, modified date, owner when available, and confidence.
6. Read a file with `drive_get_file` only when one candidate is clearly relevant or the user chooses it.
7. Route extracted content to the downstream skill, such as supplier PO, Sales Confirmation, tracking, or order-note recording.

## Output

Return:

- searches run, with exact tool names and arguments;
- authorization status;
- count of matches for each search;
- candidate file summary;
- confidence: high, medium, or low;
- next recommended skill or action.

See `references/search-patterns.md`.
