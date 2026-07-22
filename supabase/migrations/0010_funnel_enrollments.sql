-- L3 behavioral funnels — per-contact enrollment STATE.
--
-- Funnel *definitions* live in code (lib/comms/funnels/definitions.js), version-controlled;
-- only the moving state lives here. One row = one contact's journey through one funnel.
--
-- See PLAN-L3-BehavioralFunnels-2026-07-22.md. The engine ships dark (ENABLE_FUNNELS unset)
-- and test-only (FUNNELS_TEST_ONLY) — this table can exist safely with nothing sending.
create table if not exists funnel_enrollments (
  id             uuid primary key default gen_random_uuid(),
  contact_id     uuid not null references contacts(id) on delete cascade,
  funnel_key     text not null,
  status         text not null default 'active',  -- active | processing | completed | converted | exited | failed
  current_step   int  not null default 0,
  enrolled_at    timestamptz not null default now(),
  next_action_at timestamptz not null,            -- when the current step is due
  last_action_at timestamptz,
  enroll_event_id uuid,                            -- the web_event that triggered enrollment
  enroll_data    jsonb,                            -- {product, url, ...} for step interpolation
  exit_reason    text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- At most ONE live enrollment per (contact, funnel): the enrollment dedup + the advance lease
-- both rely on this. `processing` is the claimed-but-not-finished state during a sweep.
create unique index if not exists funnel_enroll_active_uq
  on funnel_enrollments (contact_id, funnel_key)
  where status in ('active', 'processing');

-- Claim-due query: "active enrollments whose step is now due".
create index if not exists funnel_enroll_due_idx
  on funnel_enrollments (next_action_at) where status = 'active';

-- Re-enrollment cooldown + history lookups.
create index if not exists funnel_enroll_contact_idx
  on funnel_enrollments (contact_id, funnel_key, enrolled_at desc);

-- Same deny-by-default posture as the rest of the spine: service role only.
alter table funnel_enrollments enable row level security;

drop trigger if exists funnel_enrollments_updated_at on funnel_enrollments;
create trigger funnel_enrollments_updated_at before update on funnel_enrollments
  for each row execute function set_updated_at();
