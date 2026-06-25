-- =====================================================================
-- Jordan Stand Tall — resident resource directories
-- Tourism spots, government offices & services, and emergency numbers.
-- Paste into the Supabase SQL editor and run once (after 0005).
-- =====================================================================
--
-- Why this exists:
--   The site is growing from a community game hub into a public resource for
--   the residents of Jordan. These three tables back the public /explore pages.
--   They hold PUBLIC, read-only reference data: anyone (logged in or not) may
--   read the active rows, and only the service role writes to them (via the
--   seed file or the Supabase dashboard). The *_ar columns are reserved for
--   Arabic content we may add later — unused by the UI for now.

-- ---------- tourism spots ----------
create table if not exists public.tourism_spots (
  id           uuid primary key default gen_random_uuid(),
  slug         text unique not null,
  name         text not null,
  name_ar      text,
  governorate  text not null,         -- one of Jordan's 12 governorates
  category     text not null,         -- archaeological | nature | religious | leisure | cultural | adventure
  summary      text,
  summary_ar   text,
  description  text,
  image_url    text,
  maps_url     text,
  lat          numeric,
  lng          numeric,
  best_time    text,
  entry_fee    text,
  sort         integer not null default 0,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

-- ---------- government offices & services ----------
create table if not exists public.gov_services (
  id           uuid primary key default gen_random_uuid(),
  slug         text unique not null,
  name         text not null,
  name_ar      text,
  category     text not null,         -- civil | traffic | tax | social | municipal | ministry | egov
  summary      text,
  summary_ar   text,
  description  text,
  governorate  text,                  -- nullable: many departments are national
  address      text,
  phone        text,
  hotline      text,
  website      text,
  hours        text,
  maps_url     text,
  sort         integer not null default 0,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

-- ---------- emergency & useful numbers ----------
create table if not exists public.emergency_numbers (
  id           uuid primary key default gen_random_uuid(),
  label        text not null,
  label_ar     text,
  number       text not null,
  category     text,                  -- emergency | tourist | health | social | utilities
  description  text,
  sort         integer not null default 0,
  active       boolean not null default true
);

-- ---------- row level security: public read of active rows ----------
-- Same shape as community_stats (0005): anon + authenticated may SELECT active
-- rows. There are no write policies — content is curated via the seed file /
-- Supabase dashboard (service role bypasses RLS), never from the browser.
alter table public.tourism_spots     enable row level security;
alter table public.gov_services      enable row level security;
alter table public.emergency_numbers enable row level security;

drop policy if exists tourism_spots_read on public.tourism_spots;
create policy tourism_spots_read on public.tourism_spots
  for select to anon, authenticated using (active);

drop policy if exists gov_services_read on public.gov_services;
create policy gov_services_read on public.gov_services
  for select to anon, authenticated using (active);

drop policy if exists emergency_numbers_read on public.emergency_numbers;
create policy emergency_numbers_read on public.emergency_numbers
  for select to anon, authenticated using (active);

grant select on public.tourism_spots     to anon, authenticated;
grant select on public.gov_services       to anon, authenticated;
grant select on public.emergency_numbers  to anon, authenticated;
