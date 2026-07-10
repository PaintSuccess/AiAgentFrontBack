-- Communications Control Center — persistence spine (Phase 1)
-- One thread per contact; all channels interleave. Backend writes via the service
-- role only, so RLS is enabled with no public policies (deny-by-default to anon).

create extension if not exists "pgcrypto";

-- ── contacts ──────────────────────────────────────────────────────────────────
-- Master identity. Exists even for people who are not Shopify customers yet.
create table if not exists contacts (
  id                  uuid primary key default gen_random_uuid(),
  shopify_customer_id text,
  name                text,
  email               text,
  phone               text,          -- E.164
  whatsapp            text,          -- E.164 (usually same as phone)
  tags                text[],
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
-- Partial-unique identity keys enable contact resolution / upsert-by-identity.
create unique index if not exists contacts_phone_key on contacts (phone) where phone is not null;
create unique index if not exists contacts_email_key on contacts (email) where email is not null;
create unique index if not exists contacts_shopify_key on contacts (shopify_customer_id) where shopify_customer_id is not null;

-- ── threads ───────────────────────────────────────────────────────────────────
-- Exactly one thread per contact (client's "one chat per customer" model).
create table if not exists threads (
  id                   uuid primary key default gen_random_uuid(),
  contact_id           uuid not null references contacts(id) on delete cascade,
  control_mode         text not null default 'ai',    -- ai | human | paused
  status               text not null default 'open',  -- open | closed | snoozed
  assigned_to          text,
  subject              text,
  last_message_at      timestamptz,
  last_message_preview text,
  last_channel         text,
  unread_count         integer not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create unique index if not exists threads_contact_key on threads (contact_id);
create index if not exists threads_last_message_idx on threads (last_message_at desc nulls last);

-- ── messages ──────────────────────────────────────────────────────────────────
create table if not exists messages (
  id                uuid primary key default gen_random_uuid(),
  thread_id         uuid not null references threads(id) on delete cascade,
  contact_id        uuid not null references contacts(id) on delete cascade,
  channel           text not null,      -- sms | whatsapp | email | chat | voice
  direction         text not null,      -- inbound | outbound
  author            text not null,      -- customer | ai | human | system
  body              text,
  media             jsonb,
  status            text,               -- queued | sent | delivered | read | failed | received
  external_provider text,               -- twilio | meta | elevenlabs | email
  external_id       text,               -- Twilio SID / ElevenLabs conversation id / Meta id
  error_code        text,
  error_message     text,
  cost              numeric,
  metadata          jsonb,
  sent_at           timestamptz not null default now(),  -- when the message occurred
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists messages_thread_idx on messages (thread_id, sent_at);
create index if not exists messages_contact_idx on messages (contact_id, sent_at);
-- Idempotency: a provider message id maps to exactly one row (partial: outbound
-- TwiML AI replies have no id and are exempt).
create unique index if not exists messages_external_key
  on messages (external_provider, external_id) where external_id is not null;

-- ── voice_calls ───────────────────────────────────────────────────────────────
create table if not exists voice_calls (
  id                        uuid primary key default gen_random_uuid(),
  message_id                uuid references messages(id) on delete set null,
  thread_id                 uuid references threads(id) on delete cascade,
  contact_id                uuid references contacts(id) on delete cascade,
  twilio_call_sid           text,
  elevenlabs_conversation_id text,
  direction                 text,
  status                    text,
  duration_seconds          integer,
  recording_url             text,
  transcript                jsonb,     -- [{role, message, ts}]
  summary                   text,
  result                    text,      -- call_successful
  started_at                timestamptz,
  created_at                timestamptz not null default now()
);
create unique index if not exists voice_calls_el_key
  on voice_calls (elevenlabs_conversation_id) where elevenlabs_conversation_id is not null;
create unique index if not exists voice_calls_twilio_key
  on voice_calls (twilio_call_sid) where twilio_call_sid is not null;

-- ── events ────────────────────────────────────────────────────────────────────
-- Delivery-status history now; marketing/analytics attribution later.
create table if not exists events (
  id          uuid primary key default gen_random_uuid(),
  contact_id  uuid references contacts(id) on delete cascade,
  message_id  uuid references messages(id) on delete cascade,
  thread_id   uuid references threads(id) on delete cascade,
  type        text not null,   -- message_received | message_sent | message_delivered | message_read | message_failed | ...
  channel     text,
  data        jsonb,
  occurred_at timestamptz not null default now()
);
create index if not exists events_contact_idx on events (contact_id, occurred_at);
create index if not exists events_type_idx on events (type, occurred_at);

-- ── updated_at trigger ────────────────────────────────────────────────────────
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists contacts_set_updated_at on contacts;
create trigger contacts_set_updated_at before update on contacts
  for each row execute function set_updated_at();
drop trigger if exists threads_set_updated_at on threads;
create trigger threads_set_updated_at before update on threads
  for each row execute function set_updated_at();
drop trigger if exists messages_set_updated_at on messages;
create trigger messages_set_updated_at before update on messages
  for each row execute function set_updated_at();

-- ── RLS: deny-by-default (backend uses the service role, which bypasses RLS) ────
alter table contacts    enable row level security;
alter table threads     enable row level security;
alter table messages    enable row level security;
alter table voice_calls enable row level security;
alter table events      enable row level security;
