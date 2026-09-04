-- FlowGuard Razorpay live integration. Run in the Supabase SQL editor before
-- setting Razorpay production credentials. Access tokens are AES-GCM encrypted
-- by the application; this database never receives plaintext OAuth secrets.

create table if not exists public.razorpay_connections (
  organization_id text primary key references public.organizations(id) on delete cascade,
  razorpay_account_id text not null unique,
  access_token_ciphertext text not null,
  refresh_token_ciphertext text not null,
  access_token_expires_at timestamptz not null,
  refresh_token_expires_at timestamptz,
  consent_version text not null,
  consented_at timestamptz not null,
  connected_by uuid not null references auth.users(id),
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz,
  revoked_at timestamptz
);

create table if not exists public.razorpay_oauth_states (
  state_digest text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create table if not exists public.razorpay_webhook_events (
  event_id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  event_name text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  payload jsonb not null
);

create table if not exists public.privacy_consents (
  organization_id text not null references public.organizations(id) on delete cascade,
  purpose text not null,
  version text not null,
  granted_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  primary key (organization_id, purpose)
);

alter table public.razorpay_connections enable row level security;
alter table public.razorpay_oauth_states enable row level security;
alter table public.razorpay_webhook_events enable row level security;
alter table public.privacy_consents enable row level security;

-- Users may view their own connection/consent status, never tokens or webhook payloads.
create policy "members read Razorpay connection status" on public.razorpay_connections for select to authenticated
using (exists (select 1 from public.organization_memberships m where m.organization_id = razorpay_connections.organization_id and m.user_id = auth.uid()));
create policy "members read privacy consents" on public.privacy_consents for select to authenticated
using (exists (select 1 from public.organization_memberships m where m.organization_id = privacy_consents.organization_id and m.user_id = auth.uid()));

-- Token, OAuth state, webhook, and deletion writes are server-only through the
-- Supabase service role. Do not add browser write policies for these tables.
