-- Inbox features: star/pin/labels/snooze on threads, notes on contacts,
-- canned responses. status/assigned_to already exist on threads.

alter table threads add column if not exists starred      boolean not null default false;
alter table threads add column if not exists pinned       boolean not null default false;
alter table threads add column if not exists labels       text[] not null default '{}';
alter table threads add column if not exists snoozed_until timestamptz;

alter table contacts add column if not exists notes text;

create index if not exists threads_pinned_idx on threads (pinned) where pinned = true;
create index if not exists threads_starred_idx on threads (starred) where starred = true;
create index if not exists threads_assigned_idx on threads (assigned_to) where assigned_to is not null;

-- Canned responses / quick replies (backend/service-role only).
create table if not exists canned_responses (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  body       text not null,
  channel    text,            -- optional: sms | whatsapp | null (any)
  created_at timestamptz not null default now()
);
alter table canned_responses enable row level security;
