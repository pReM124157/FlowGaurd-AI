-- FlowGuard database bootstrap. Run this first in Supabase SQL Editor.

create table if not exists public.organizations (
  id text primary key,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.organization_memberships (
  organization_id text not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('OWNER', 'FINANCE_ADMIN', 'ANALYST', 'VIEWER')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table if not exists public.onboarding_progress (
  organization_id text primary key references public.organizations(id) on delete cascade,
  stage text not null check (stage in ('BUSINESS_PROFILE', 'RISK_PREFERENCES', 'DATA_CONNECTIONS', 'DATA_VALIDATION', 'INITIAL_CALCULATION', 'READY')) default 'BUSINESS_PROFILE',
  profile jsonb not null default '{}'::jsonb,
  risk_preferences jsonb not null default '{}'::jsonb,
  data_connections jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create or replace function public.create_flowguard_organization_for_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  organization_id_value text := coalesce(new.raw_user_meta_data ->> 'organization_id', 'org_' || replace(new.id::text, '-', ''));
  organization_name_value text := coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1));
begin
  insert into public.organizations (id, name)
  values (organization_id_value, organization_name_value)
  on conflict (id) do nothing;

  insert into public.organization_memberships (organization_id, user_id, role)
  values (organization_id_value, new.id, 'OWNER')
  on conflict (organization_id, user_id) do nothing;

  insert into public.onboarding_progress (organization_id)
  values (organization_id_value)
  on conflict (organization_id) do nothing;

  return new;
end;
$$;

drop trigger if exists flowguard_create_organization_on_signup on auth.users;
create trigger flowguard_create_organization_on_signup
  after insert on auth.users
  for each row execute procedure public.create_flowguard_organization_for_user();

-- Backfill users who were created before this trigger was installed.
insert into public.organizations (id, name)
select
  coalesce(user_row.raw_user_meta_data ->> 'organization_id', 'org_' || replace(user_row.id::text, '-', '')),
  coalesce(nullif(trim(user_row.raw_user_meta_data ->> 'name'), ''), split_part(user_row.email, '@', 1))
from auth.users user_row
on conflict (id) do nothing;

insert into public.organization_memberships (organization_id, user_id, role)
select
  coalesce(user_row.raw_user_meta_data ->> 'organization_id', 'org_' || replace(user_row.id::text, '-', '')),
  user_row.id,
  'OWNER'
from auth.users user_row
on conflict (organization_id, user_id) do nothing;

insert into public.onboarding_progress (organization_id)
select coalesce(user_row.raw_user_meta_data ->> 'organization_id', 'org_' || replace(user_row.id::text, '-', ''))
from auth.users user_row
on conflict (organization_id) do nothing;

alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.onboarding_progress enable row level security;

drop policy if exists "members can read their organizations" on public.organizations;
create policy "members can read their organizations" on public.organizations for select to authenticated
using (exists (select 1 from public.organization_memberships membership where membership.organization_id = organizations.id and membership.user_id = auth.uid()));

drop policy if exists "members can read memberships" on public.organization_memberships;
create policy "members can read memberships" on public.organization_memberships for select to authenticated
using (user_id = auth.uid());

drop policy if exists "members can read onboarding" on public.onboarding_progress;
create policy "members can read onboarding" on public.onboarding_progress for select to authenticated
using (exists (select 1 from public.organization_memberships membership where membership.organization_id = onboarding_progress.organization_id and membership.user_id = auth.uid()));

drop policy if exists "members can update onboarding" on public.onboarding_progress;
create policy "members can update onboarding" on public.onboarding_progress for update to authenticated
using (exists (select 1 from public.organization_memberships membership where membership.organization_id = onboarding_progress.organization_id and membership.user_id = auth.uid()))
with check (exists (select 1 from public.organization_memberships membership where membership.organization_id = onboarding_progress.organization_id and membership.user_id = auth.uid()));
