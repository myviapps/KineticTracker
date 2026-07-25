-- Manual admin creation (seed via email/password)

-- 1. Drop the auto-promotion trigger (unreliable with Supabase callback URL)
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_admin_user();

-- 2. Helper for assigning roles (admin use)
create or replace function public.grant_role(_email text, _role app_role)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_roles (user_id, role)
  select id, _role from auth.users
  where email = _email
  on conflict (user_id, role) do nothing;
  return found;
end;
$$;

-- 3. Seed the admin user if they don't already exist in auth.users
do $$
declare
  _uid uuid;
begin
  select id into _uid from auth.users where email = 'vijaydmb@gmail.com';

  if _uid is null then
    insert into auth.users (
      instance_id, id, aud, role,
      email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, recovery_token,
      email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000',
      gen_random_uuid(),
      'authenticated',
      'authenticated',
      'vijaydmb@gmail.com',
      -- SECURITY: placeholder only. Do NOT commit a real password here.
      -- Rotate immediately after first login (Supabase dashboard > Auth, or a
      -- separate seed step). This migration only runs when the admin row is
      -- absent, so editing this value does not change an already-seeded DB.
      crypt('CHANGE-ME-ON-FIRST-LOGIN', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}',
      '{}',
      now(),
      now(),
      '', '', '', ''
    )
    returning id into _uid;
  end if;

  -- Assign admin role
  insert into public.user_roles (user_id, role)
  values (_uid, 'admin')
  on conflict (user_id, role) do nothing;
end;
$$;

-- 4. Identity and refresh token entries so the user can sign in immediately
insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), id, format('{"sub":"%s","email":"%s"}', id::text, 'vijaydmb@gmail.com')::jsonb, 'email', 'vijaydmb@gmail.com', now(), now(), now()
from auth.users
where email = 'vijaydmb@gmail.com'
  and not exists (select 1 from auth.identities where user_id = auth.users.id and provider = 'email');
