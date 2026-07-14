-- Per-channel marketing consent on contacts. Email + SMS mirror Shopify's
-- consent fields (source of truth); WhatsApp + Calls are stored here only.
-- Values: subscribed | not_subscribed | unsubscribed | unknown
alter table contacts add column if not exists email_marketing    text default 'unknown';
alter table contacts add column if not exists sms_marketing       text default 'unknown';
alter table contacts add column if not exists whatsapp_marketing  text default 'unknown';
alter table contacts add column if not exists calls_consent       text default 'unknown';
alter table contacts add column if not exists do_not_call         boolean default false;
alter table contacts add column if not exists consent_source      text;   -- shopify | keyword | manual | checkout
alter table contacts add column if not exists consent_updated_at  timestamptz;
