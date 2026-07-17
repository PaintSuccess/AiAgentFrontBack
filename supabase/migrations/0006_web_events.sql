-- Storefront behaviour, captured by our own Shopify custom pixel.
--
-- Why this exists: Meta, Google, TikTok and Omnisend all have a live pixel on
-- paintaccess.com.au. We don't — so the system that owns the customer profile is the only
-- party with no idea what anyone browsed. This closes that.
--
-- Deliberately a SEPARATE table from `events`, not a new type in it:
--   * `events.contact_id` is NOT NULL-friendly but the spine assumes a known person;
--     Shopify's 7 browse/cart events carry NO customer identity, by design.
--   * These arrive from the open internet at page-view volume — orders of magnitude more
--     rows than conversation events, and untrusted. Mixing them into `events` would both
--     swamp it and weaken its guarantees.
--
-- `client_id` is Shopify's web-pixel clientId: an anonymous browser id, stable across the
-- visit. `contact_id` starts null and is filled in later when we can prove who the browser
-- is (a signed token in a WhatsApp link we sent, or a checkout). That backfill is the whole
-- point — one row per anonymous event now, attributable retroactively.
create table if not exists web_events (
  id          uuid primary key default gen_random_uuid(),
  client_id   text not null,          -- Shopify web pixel clientId (anonymous browser)
  contact_id  uuid references contacts(id) on delete set null,  -- null until stitched
  name        text not null,          -- page_viewed | product_viewed | product_added_to_cart | ...
  url         text,
  referrer    text,
  product_id  text,
  product_title text,
  variant_id  text,
  price       numeric,
  currency    text,
  data        jsonb,                  -- the trimmed raw payload
  occurred_at timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

-- "What did this browser do?" — the stitching query.
create index if not exists web_events_client_idx  on web_events (client_id, occurred_at desc);
-- "What did this person do?" — once stitched.
create index if not exists web_events_contact_idx on web_events (contact_id, occurred_at desc)
  where contact_id is not null;
create index if not exists web_events_name_idx    on web_events (name, occurred_at desc);
-- Product interest, for recommendations later.
create index if not exists web_events_product_idx on web_events (product_id, occurred_at desc)
  where product_id is not null;

-- Same deny-by-default posture as the rest of the spine: only the service role touches it.
alter table web_events enable row level security;
