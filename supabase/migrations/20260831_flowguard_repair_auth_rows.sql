-- One-time repair for Supabase Auth users created before the FlowGuard trigger.

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
