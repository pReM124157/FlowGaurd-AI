-- Run once if 20260831_flowguard_auth.sql was already applied before this file.
-- Allows an authenticated tenant member to save only its own onboarding row.

drop policy if exists "members can update onboarding" on public.onboarding_progress;

create policy "members can update onboarding"
  on public.onboarding_progress for update to authenticated
  using (exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = onboarding_progress.organization_id
      and membership.user_id = auth.uid()
  ))
  with check (exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = onboarding_progress.organization_id
      and membership.user_id = auth.uid()
  ));
