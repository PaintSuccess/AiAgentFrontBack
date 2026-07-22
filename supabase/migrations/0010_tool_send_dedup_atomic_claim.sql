-- 0010_tool_send_dedup_atomic_claim.sql
-- Hardens 0009's dedup design per a Codex review of commit 88855e4 (2026-07-22):
--
-- Bug fixed: claimSend() called sweep_tool_send_dedup() BEFORE the insert, but ignored
-- that RPC's own error. If the sweep silently failed (permissions, dropped function, a
-- transient RPC error), a stale row from an OLD send could survive past its TTL. A later,
-- genuinely new send with the same recipient+body would then hit the stale row on insert
-- (23505) and be reported "duplicate" — silently blocking a legitimate resend forever,
-- with no automatic recovery (nothing re-triggers the sweep for that specific key).
--
-- Fix: do the staleness check INSIDE the same atomic operation as the claim, evaluated
-- entirely on the DB clock. No separate sweep call is on the correctness path anymore —
-- 0009's sweep_tool_send_dedup() is kept only as an optional table-size housekeeping call.
create or replace function claim_tool_send_dedup(p_key text, p_kind text, p_ttl_seconds int)
returns text  -- 'claimed' | 'duplicate'
language plpgsql
as $$
declare
  v_age interval;
begin
  begin
    insert into tool_send_dedup (dedup_key, kind) values (p_key, p_kind);
    return 'claimed';
  exception when unique_violation then
    -- FOR UPDATE takes a row lock here so two concurrent reclaims of the SAME stale row
    -- can't both succeed: the second caller's SELECT blocks until the first caller's
    -- UPDATE (below) commits, then re-reads the now-fresh created_at and correctly sees
    -- the row as no longer stale — it returns 'duplicate' instead of also reclaiming.
    -- Without this lock both could read the same stale age and both "reclaim" the key.
    select now() - created_at into v_age
      from tool_send_dedup where dedup_key = p_key for update;
    if v_age is null then
      -- Row vanished between the failed insert and this select (a concurrent release) —
      -- claim it now rather than reporting a phantom duplicate.
      insert into tool_send_dedup (dedup_key, kind) values (p_key, p_kind)
        on conflict (dedup_key) do update set created_at = now();
      return 'claimed';
    end if;
    if v_age > make_interval(secs => greatest(p_ttl_seconds, 1)) then
      -- Existing claim is stale (this is the self-healing path 0009 was missing):
      -- reclaim it atomically regardless of whether the periodic sweep ever ran.
      update tool_send_dedup set created_at = now() where dedup_key = p_key;
      return 'claimed';
    end if;
    return 'duplicate';
  end;
end;
$$;
