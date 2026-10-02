-- PersonaMatch schema. Safe to re-run: every statement is idempotent.
-- Apply with `npm run db:setup` (uses SUPABASE_DB_PASSWORD from .env.local)
-- or paste into the Supabase SQL editor.

create table if not exists public.profiles (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  linkedin_url        text,
  instagram_url       text,
  raw_linkedin_data   jsonb,
  raw_instagram_data  jsonb,
  needs               text[] not null default '{}',
  hobbies             text[] not null default '{}',
  interests           text[] not null default '{}',
  "values"            text[] not null default '{}',
  communication_style text,
  -- [{ category, claim, source: 'linkedin' | 'instagram', section, quote }]
  evidence            jsonb not null default '[]',
  created_at          timestamptz not null default now()
);

create table if not exists public.dates (
  id              uuid primary key default gen_random_uuid(),
  person_a_id     uuid not null references public.profiles (id) on delete cascade,
  person_b_id     uuid not null references public.profiles (id) on delete cascade,
  -- [{ speaker: 'a' | 'b', text }]
  transcript      jsonb not null default '[]',
  venue           text,
  shared_interest text,
  score_a         numeric,
  score_b         numeric,
  reason_a        text,
  reason_b        text,
  second_date_a   boolean,
  second_date_b   boolean,
  created_at      timestamptz not null default now(),
  constraint dates_distinct_people check (person_a_id <> person_b_id)
);

create table if not exists public.rankings (
  id                  uuid primary key default gen_random_uuid(),
  person_id           uuid not null references public.profiles (id) on delete cascade,
  candidate_id        uuid not null references public.profiles (id) on delete cascade,
  rank                integer not null,
  compatibility_score numeric,
  reasoning           text,
  created_at          timestamptz not null default now(),
  constraint rankings_person_candidate_key unique (person_id, candidate_id),
  constraint rankings_distinct_people check (person_id <> candidate_id)
);

create index if not exists dates_person_a_idx on public.dates (person_a_id);
create index if not exists dates_person_b_idx on public.dates (person_b_id);
create index if not exists rankings_candidate_idx on public.rankings (candidate_id);

-- RLS on with no policies: the anon key can't read or write these tables.
-- All access goes through server routes using SUPABASE_SERVICE_ROLE_KEY,
-- which bypasses RLS.
alter table public.profiles enable row level security;
alter table public.dates    enable row level security;
alter table public.rankings enable row level security;
