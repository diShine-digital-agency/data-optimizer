-- ════════════════════════════════════════════════════════════════════════════
--  Dishine Convert — initial schema
--
--  Reverse-engineered from the edge-function code. This migration creates:
--    - enum `app_role`          ('admin' | 'user')
--    - table `user_roles`       (role assignments)
--    - table `subscriptions`    (Stripe-backed tier state, live + sandbox)
--    - table `usage_log`        (one row per successful conversion)
--    - table `api_keys`         (public API access — Pro feature)
--    - RPCs `has_role`, `has_active_subscription`, `is_user_blocked`
--    - RLS policies that allow users to see only their own rows and admins
--      to see everything.
--
--  Run with the Supabase CLI:
--      supabase db reset                # local dev
--      supabase db push                  # hosted project
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Extensions ─────────────────────────────────────────────────────────────
create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";

-- ─── Enums ──────────────────────────────────────────────────────────────────
do $$ begin
  create type public.app_role as enum ('admin', 'user');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.subscription_env as enum ('live', 'sandbox');
exception when duplicate_object then null; end $$;

-- ─── user_roles ─────────────────────────────────────────────────────────────
create table if not exists public.user_roles (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       public.app_role not null default 'user',
  created_at timestamptz not null default now(),
  blocked    boolean not null default false,
  blocked_at timestamptz,
  unique (user_id, role)
);

create index if not exists user_roles_user_id_idx on public.user_roles (user_id);

-- ─── subscriptions ──────────────────────────────────────────────────────────
create table if not exists public.subscriptions (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null references auth.users(id) on delete cascade,
  stripe_subscription_id    text not null unique,
  stripe_customer_id        text,
  product_id                text,
  price_id                  text,
  status                    text not null,                         -- 'active' | 'trialing' | 'past_due' | 'canceled' | ...
  current_period_end        timestamptz,
  cancel_at_period_end      boolean not null default false,
  environment               public.subscription_env not null default 'live',
  metadata                  jsonb not null default '{}'::jsonb,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index if not exists subscriptions_user_id_idx on public.subscriptions (user_id);
create index if not exists subscriptions_status_idx on public.subscriptions (status);

-- ─── usage_log ──────────────────────────────────────────────────────────────
-- One row per successful (or failed) conversion. Drives:
--   - Free-tier daily quota
--   - Pro monthly rolling 30-day cap
--   - Operator analytics
--
-- Raw IPs are NEVER stored — only a salted hash of the /24 (v4) or /48 (v6) prefix.
create table if not exists public.usage_log (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references auth.users(id) on delete set null,
  fingerprint      text,
  ip_hash          text,                       -- salted hash of the request IP prefix
  client_hash      text,                       -- client-side stable hash (localStorage)
  filename         text,
  format           text not null check (format in ('markdown', 'json')),
  file_size        bigint,
  success          boolean not null default true,
  country          text,                       -- ISO-2, coarse
  user_agent_brief text,                       -- e.g. "Chrome/macOS"
  created_at       timestamptz not null default now()
);

create index if not exists usage_log_user_id_created_at_idx on public.usage_log (user_id, created_at desc);
create index if not exists usage_log_created_at_idx on public.usage_log (created_at desc);
create index if not exists usage_log_ip_hash_idx on public.usage_log (ip_hash, created_at desc);
create index if not exists usage_log_fingerprint_idx on public.usage_log (fingerprint, created_at desc);
create index if not exists usage_log_client_hash_idx on public.usage_log (client_hash, created_at desc);

-- ─── api_keys ───────────────────────────────────────────────────────────────
-- Pro feature: programmatic access via public API (`dsh_<prefix>_<secret>`).
-- Secrets are never stored in plaintext — only the sha256(secret) hash.
create table if not exists public.api_keys (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,                 -- user-facing label, e.g. "staging scraper"
  prefix      text not null unique,          -- 8-char public prefix, used for lookups
  key_hash    text not null,                 -- sha256(secret), hex
  last_four   text,                          -- last 4 chars of the secret, for display only
  last_used_at timestamptz,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);

create index if not exists api_keys_user_id_idx on public.api_keys (user_id);
create index if not exists api_keys_prefix_idx on public.api_keys (prefix);

-- ─── RPCs ───────────────────────────────────────────────────────────────────

-- has_role(_user_id, _role) → boolean
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id
      and role = _role
      and coalesce(blocked, false) = false
  );
$$;

-- is_user_blocked(_user_id) → boolean  (admin one-click block)
create or replace function public.is_user_blocked(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id
      and blocked = true
  );
$$;

-- has_active_subscription(user_uuid, check_env) → boolean
create or replace function public.has_active_subscription(
  user_uuid uuid,
  check_env public.subscription_env default 'live'
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.subscriptions
    where user_id = user_uuid
      and environment = check_env
      and status in ('active', 'trialing')
      and (current_period_end is null or current_period_end > now())
  );
$$;

-- ─── RLS policies ───────────────────────────────────────────────────────────
alter table public.user_roles     enable row level security;
alter table public.subscriptions  enable row level security;
alter table public.usage_log      enable row level security;
alter table public.api_keys       enable row level security;

-- user_roles: users can read their own roles; admins can read/write all.
drop policy if exists "user_roles_select_own" on public.user_roles;
create policy "user_roles_select_own"
  on public.user_roles for select
  using (auth.uid() = user_id or public.has_role(auth.uid(), 'admin'));

drop policy if exists "user_roles_admin_all" on public.user_roles;
create policy "user_roles_admin_all"
  on public.user_roles for all
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- subscriptions: users read own; admins read/write all.
drop policy if exists "subscriptions_select_own" on public.subscriptions;
create policy "subscriptions_select_own"
  on public.subscriptions for select
  using (auth.uid() = user_id or public.has_role(auth.uid(), 'admin'));

drop policy if exists "subscriptions_admin_all" on public.subscriptions;
create policy "subscriptions_admin_all"
  on public.subscriptions for all
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- usage_log: users read their own rows; admins read all.
-- Writes are performed only by the service role (edge functions), which
-- bypasses RLS, so no INSERT policy is needed.
drop policy if exists "usage_log_select_own" on public.usage_log;
create policy "usage_log_select_own"
  on public.usage_log for select
  using (auth.uid() = user_id or public.has_role(auth.uid(), 'admin'));

-- api_keys: users manage their own keys; admins read all (never expose hash).
drop policy if exists "api_keys_select_own" on public.api_keys;
create policy "api_keys_select_own"
  on public.api_keys for select
  using (auth.uid() = user_id or public.has_role(auth.uid(), 'admin'));

drop policy if exists "api_keys_insert_own" on public.api_keys;
create policy "api_keys_insert_own"
  on public.api_keys for insert
  with check (auth.uid() = user_id);

drop policy if exists "api_keys_update_own" on public.api_keys;
create policy "api_keys_update_own"
  on public.api_keys for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "api_keys_delete_own" on public.api_keys;
create policy "api_keys_delete_own"
  on public.api_keys for delete
  using (auth.uid() = user_id);

-- ─── Helpful views (optional) ───────────────────────────────────────────────
create or replace view public.usage_last_30d as
  select user_id, count(*) as conversions
  from public.usage_log
  where created_at > now() - interval '30 days'
  group by user_id;

-- Grant execute on the RPCs to authenticated & anon roles so the edge
-- functions running as service_role can call them, and signed-in clients
-- can introspect their own state.
grant execute on function public.has_role(uuid, public.app_role) to anon, authenticated, service_role;
grant execute on function public.is_user_blocked(uuid) to anon, authenticated, service_role;
grant execute on function public.has_active_subscription(uuid, public.subscription_env) to anon, authenticated, service_role;
