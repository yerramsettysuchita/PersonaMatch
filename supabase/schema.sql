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

-- Consent and self-declared preferences. Entered by the person at ingest,
-- never inferred from LinkedIn or Instagram. Only opted_in profiles are
-- dated or ranked; null preferences mean "no constraint".
alter table public.profiles
  add column if not exists opted_in      boolean not null default false,
  add column if not exists looking_for   text check (looking_for in ('long-term', 'short-term', 'friendship-first', 'open')),
  add column if not exists age           integer check (age between 18 and 120),
  add column if not exists age_range_min integer check (age_range_min between 18 and 120),
  add column if not exists age_range_max integer check (age_range_max between 18 and 120),
  add column if not exists city          text,
  -- { proposed, verified }: how many of Gemini's citations verified at ingest
  add column if not exists citation_stats jsonb;

-- Sandbox. is_sample marks fictional sample profiles (scripts/demo-profiles.json).
-- Samples date each other; a real person dates samples only if they set
-- sandbox_opt_in. Real-to-real dating never involves samples.
alter table public.profiles
  add column if not exists is_sample      boolean not null default false,
  add column if not exists sandbox_opt_in boolean not null default false;

alter table public.profiles drop constraint if exists profiles_age_range_order;
alter table public.profiles add constraint profiles_age_range_order
  check (age_range_min is null or age_range_max is null or age_range_min <= age_range_max);

-- One profile per LinkedIn URL: re-ingesting the same LinkedIn updates it.
-- (Pasted-text profiles have no URL; Postgres allows many NULLs.)
alter table public.profiles drop constraint if exists profiles_linkedin_url_key;
alter table public.profiles add constraint profiles_linkedin_url_key unique (linkedin_url);

-- Persistent scrape cache (24h TTL enforced in code) so retries and
-- re-ingests don't pay Apify twice, across serverless instances.
create table if not exists public.scrape_cache (
  normalized_url text primary key,
  platform       text not null check (platform in ('linkedin', 'instagram')),
  data           jsonb not null,
  fetched_at     timestamptz not null default now()
);

-- Per-IP rate limiting for the expensive routes (one row per request).
-- ip_hash is a SHA-256 of the client IP, so raw IPs aren't stored.
create table if not exists public.rate_limits (
  id         bigint generated always as identity primary key,
  bucket     text not null,
  ip_hash    text not null,
  created_at timestamptz not null default now()
);
create index if not exists rate_limits_lookup_idx on public.rate_limits (bucket, ip_hash, created_at);

create index if not exists dates_person_a_idx on public.dates (person_a_id);
create index if not exists dates_person_b_idx on public.dates (person_b_id);
create index if not exists rankings_candidate_idx on public.rankings (candidate_id);

-- RLS on with no policies: the anon key can't read or write these tables.
-- All access goes through server routes using SUPABASE_SERVICE_ROLE_KEY,
-- which bypasses RLS.
alter table public.profiles enable row level security;
alter table public.dates    enable row level security;
alter table public.rankings enable row level security;
alter table public.scrape_cache enable row level security;
alter table public.rate_limits  enable row level security;
