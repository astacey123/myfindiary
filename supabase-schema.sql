-- ============================================================================
-- Financial Diary — Supabase schema
-- ============================================================================
-- Run this once in your Supabase project's SQL editor (Project → SQL Editor →
-- New query → paste all of this → Run). It sets up:
--   1. a `profiles` table that extends Supabase's built-in auth.users with a
--      name and a `has_paid` flag (set true once Stripe confirms the £5 payment)
--   2. a `diary_entries` table that stores each user's logged snapshots
--   3. `goals` and `goal_checkins` tables for the goal-tracking page (a target
--      value/date, plus periodic check-ins a member logs to track progress)
--   4. Row Level Security (RLS) so every user can only ever see their own data
--   5. a trigger that automatically creates a `profiles` row whenever someone
--      signs up, so you never have to do it manually from the frontend
-- ============================================================================

-- ---------- profiles ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text,
  email text,
  has_paid boolean not null default false,
  stripe_customer_id text,
  stripe_checkout_session_id text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Each signed-in user may read and update only their own profile row.
create policy "Users can view their own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Only the backend (using the service role key, which bypasses RLS entirely)
-- should ever set has_paid = true — that happens in the Stripe webhook, never
-- from the browser. No insert/delete policy is defined for regular users;
-- rows are created automatically by the trigger below.

-- Automatically create a profile row the moment someone signs up via Supabase Auth.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name, email)
  values (new.id, new.raw_user_meta_data ->> 'name', new.email);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------- diary_entries ----------
create table if not exists public.diary_entries (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  entry_date date not null default current_date,
  category text not null,
  summary text not null,
  created_at timestamptz not null default now()
);

alter table public.diary_entries enable row level security;

create index if not exists diary_entries_user_id_idx on public.diary_entries (user_id, created_at desc);

-- Each signed-in user may only see and create their own diary entries.
create policy "Users can view their own diary entries"
  on public.diary_entries for select
  using (auth.uid() = user_id);

create policy "Users can insert their own diary entries"
  on public.diary_entries for insert
  with check (auth.uid() = user_id);

-- ---------- goals ----------
-- A goal a member sets themselves (e.g. "Net worth", "House deposit"), with a
-- target value and a target date. They come back every quarter/year and log a
-- check-in (see goal_checkins below); the frontend fits a trend line through
-- those check-ins to project whether they're on pace to hit the target.
create table if not exists public.goals (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  target_value numeric not null check (target_value >= 0),
  target_date date not null,
  created_at timestamptz not null default now()
);

alter table public.goals enable row level security;

create index if not exists goals_user_id_idx on public.goals (user_id, created_at desc);

create policy "Users can view their own goals"
  on public.goals for select
  using (auth.uid() = user_id);

create policy "Users can insert their own goals"
  on public.goals for insert
  with check (auth.uid() = user_id);

create policy "Users can delete their own goals"
  on public.goals for delete
  using (auth.uid() = user_id);

-- ---------- goal_checkins ----------
-- One row per periodic update a member logs against a goal (e.g. "as of this
-- quarter, my net worth is £X"). At least two check-ins are needed before a
-- trend line can be fitted.
create table if not exists public.goal_checkins (
  id bigint generated always as identity primary key,
  goal_id bigint not null references public.goals (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  checkin_date date not null default current_date,
  value numeric not null check (value >= 0),
  created_at timestamptz not null default now()
);

alter table public.goal_checkins enable row level security;

create index if not exists goal_checkins_goal_id_idx on public.goal_checkins (goal_id, checkin_date);

create policy "Users can view their own goal check-ins"
  on public.goal_checkins for select
  using (auth.uid() = user_id);

create policy "Users can insert their own goal check-ins"
  on public.goal_checkins for insert
  with check (auth.uid() = user_id);

-- ============================================================================
-- That's it. After running this, go to Project Settings → API to grab your
-- Project URL and anon public key — you'll need those for the frontend.
-- ============================================================================
