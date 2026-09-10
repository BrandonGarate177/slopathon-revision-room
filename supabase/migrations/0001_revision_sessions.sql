-- Documentation only. Not applied by the prototype; sessions are written to sessions/*.json on disk.
-- One row per async review link. The token is the URL; the sheet fills in when the client presses Done.
create table if not exists revision_sessions (
  id           text primary key,            -- token in the review URL
  song_id      text not null,
  client_name  text,
  cues         jsonb not null default '[]',
  consent      jsonb,                       -- { accepted_at, retention_days }
  created_at   timestamptz not null default now(),
  finished_at  timestamptz,
  sheet        jsonb
);

-- RLS intent: anon may insert/update only the row whose id matches the token it holds;
-- only the founder (authenticated owner) may select. Policies are written when auth lands.
alter table revision_sessions enable row level security;
