-- Auto-takeover: when a human replies, the AI pauses on that thread until this
-- timestamp. Rolling window, extended on each human send; when it lapses (human
-- goes quiet) the thread auto-hands back to the AI.
alter table threads add column if not exists ai_paused_until timestamptz;
