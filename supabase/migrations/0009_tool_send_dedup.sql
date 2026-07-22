-- 0009_tool_send_dedup.sql
-- Idempotency ledger for side-effecting ElevenLabs tool calls (send_sms_notification,
-- send_email_notification).
--
-- WHY: when a tool call is "abandoned" (the caller talks over it, or the session ends),
-- ElevenLabs stops waiting for the response, but our webhook keeps running server-side to
-- completion — verified 2026-07-22 (Anton's escalate showed "abandoned" yet the DB proved
-- the staff page + customer reply both went out). The LLM then often RETRIES the same tool
-- call. For read-only tools that is harmless; for send_sms / send_email it can fire the side
-- effect twice — a duplicate SMS, or a duplicate quote email + duplicate Shopify draft order.
--
-- A row here is a short-lived claim keyed on a content hash (kind + recipient + body). The
-- primary key gives the atomic claim: concurrent retries race on the insert and exactly one
-- wins. lib/tool-dedup.js sweeps rows older than the TTL on each claim, so the table stays
-- tiny AND a genuine identical re-request after the window is allowed through.

create table if not exists tool_send_dedup (
  dedup_key   text primary key,          -- "<kind>:<sha256(recipient \0 body)>"
  kind        text not null,             -- sms | email
  created_at  timestamptz not null default now()
);

-- Supports the stale-claim sweep (delete where created_at < now() - ttl).
create index if not exists tool_send_dedup_created_idx on tool_send_dedup (created_at);

-- Stale-claim sweep, evaluated entirely on the DB clock. lib/tool-dedup.js calls this
-- before each claim insert. Doing the comparison here (now() vs created_at, both DB time)
-- rather than app-side avoids any dependence on the serverless clock being in sync with
-- the database — an app-computed cutoff that ran ahead of the DB clock could expire a
-- claim early and let a duplicate through.
create or replace function sweep_tool_send_dedup(p_ttl_seconds int)
returns void
language sql
as $$
  delete from tool_send_dedup
  where created_at < now() - make_interval(secs => greatest(p_ttl_seconds, 1));
$$;
