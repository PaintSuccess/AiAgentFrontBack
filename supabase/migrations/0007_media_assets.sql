-- Media registry: one row per reusable asset (video / PDF / image) the funnel can send.
--
-- Storage decision (2026-07-16): Supabase Storage now, Cloudflare R2 at scale. The whole
-- point of storing `storage_provider` + `storage_bucket` + `storage_key` SEPARATELY from
-- `public_url` is that the R2 migration is a re-upload + a URL rewrite, not a schema change —
-- callers resolve the URL through the registry, never hard-code it. See
-- PLAN-Marketing-Pipeline-2026-07-16.md §Stage-4.
--
-- Why a public URL at all: we send WhatsApp on Twilio, which fetches `MediaUrl` itself, so a
-- publicly-reachable link is all that's needed — no Meta media-id upload/caching. The
-- `whatsapp_media_id` columns exist only for a possible future move to the Meta Cloud API
-- (where caching an uploaded id avoids re-fetching); they are unused on Twilio.
create table if not exists media_assets (
  id            uuid primary key default gen_random_uuid(),
  asset_key     text not null unique,          -- stable human key, e.g. "dans-backpack-demo"
  title         text not null,
  kind          text not null,                 -- video | pdf | image
  funnel_step   text,                          -- which step it belongs to (set once the scenario exists)

  storage_provider text not null default 'supabase',  -- supabase | r2 (explicit, for the migration)
  storage_bucket   text not null,
  storage_key      text not null,              -- path within the bucket
  public_url       text not null,              -- resolved URL (re-derivable from the three above)

  mime          text,
  size_bytes    bigint,
  sha256        text,                          -- dedupe / integrity

  -- Meta Cloud API delivery cache (unused on Twilio). IDs expire ~30d, hence the timestamp.
  whatsapp_media_id            text,
  whatsapp_media_id_expires_at timestamptz,

  status        text not null default 'ready', -- ready | processing | archived
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists media_assets_step_idx on media_assets (funnel_step) where funnel_step is not null;
create index if not exists media_assets_kind_idx on media_assets (kind, status);

-- Same deny-by-default posture as the rest of the spine: only the service role touches it.
alter table media_assets enable row level security;

drop trigger if exists media_assets_updated_at on media_assets;
create trigger media_assets_updated_at before update on media_assets
  for each row execute function set_updated_at();
