-- Run once in Supabase SQL Editor. Safely provisions any authenticated user's
-- FlowGuard tenant, including users created before the original signup trigger.

create or replace function public.provision_current_flowguard_tenant()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  auth_user auth.users%rowtype;
  organization_id_value text;
  organization_name_value text;
begin
  select * into auth_user from auth.users where id = auth.uid();
  if not found then
    raise exception 'Authenticated user not found';
  end if;

  organization_id_value := coalesce(auth_user.raw_user_meta_data ->> 'organization_id', 'org_' || replace(auth_user.id::text, '-', ''));
  organization_name_value := coalesce(nullif(trim(auth_user.raw_user_meta_data ->> 'name'), ''), split_part(auth_user.email, '@', 1));

  insert into public.organizations (id, name)
  values (organization_id_value, organization_name_value)
  on conflict (id) do nothing;

  insert into public.organization_memberships (organization_id, user_id, role)
  values (organization_id_value, auth_user.id, 'OWNER')
  on conflict (organization_id, user_id) do nothing;

  insert into public.onboarding_progress (organization_id)
  values (organization_id_value)
  on conflict (organization_id) do nothing;
end;
$$;

revoke all on function public.provision_current_flowguard_tenant() from public;
grant execute on function public.provision_current_flowguard_tenant() to authenticated;
