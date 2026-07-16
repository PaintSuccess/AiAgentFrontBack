-- First-touch Click-to-WhatsApp ad attribution.
--
-- Meta sends the referral payload (including ctwa_clid) ONLY on the first inbound
-- message of an ad-initiated conversation and never re-sends it, so a missed capture is
-- permanently unrecoverable. ctwa_clid is what Meta's Conversions API needs to attribute
-- a later order back to the originating ad.
--
-- Three places record it, deliberately:
--   contacts.first_referral  — first touch, written once, never overwritten (attribution)
--   events (type='ad_referral') — every touch, for multi-touch analysis later
--   messages.metadata.referral — the raw payload alongside the message it arrived on
alter table contacts add column if not exists first_referral    jsonb;
alter table contacts add column if not exists first_referral_at timestamptz;

-- Look up a contact by ad click id when firing a Conversions API event.
create index if not exists contacts_first_referral_clid_idx
  on contacts ((first_referral->>'ctwa_clid'))
  where first_referral is not null;

create index if not exists events_ad_referral_idx
  on events (occurred_at) where type = 'ad_referral';
