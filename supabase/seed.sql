-- Relai — local-dev seed.
--
-- Runs after migrations on `supabase db reset`. Creates:
--   * One firm (Cabinet Tremblay & Associés)
--   * One accountant user (demo@relai.app / password: demo1234)
--   * Two demo clients (one individual, one business)
--
-- The auth.users insert pattern below is supported on the Supabase local
-- stack; in production, real signups go through Supabase Auth.

-- --- AUTH USER -------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  '11111111-1111-1111-1111-111111111111',
  'authenticated',
  'authenticated',
  'demo@relai.app',
  crypt('demo1234', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"name":"Marie Tremblay"}'::jsonb,
  now(), now(),
  '', '', '', ''
)
on conflict (id) do nothing;

insert into auth.identities (
  id, user_id, provider_id, provider, identity_data,
  last_sign_in_at, created_at, updated_at
) values (
  gen_random_uuid(),
  '11111111-1111-1111-1111-111111111111',
  'demo@relai.app',
  'email',
  jsonb_build_object('sub', '11111111-1111-1111-1111-111111111111', 'email', 'demo@relai.app'),
  now(), now(), now()
)
on conflict do nothing;

-- --- FIRM + USER -----------------------------------------------------------
insert into firms (id, name, locale_default, brand_color, timezone, plan)
values (
  '22222222-2222-2222-2222-222222222222',
  'Cabinet Tremblay & Associés',
  'fr',
  '#1e293b',
  'America/Toronto',
  'trial'
)
on conflict (id) do nothing;

insert into users (id, firm_id, email, name, role, locale)
values (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  'demo@relai.app',
  'Marie Tremblay',
  'owner',
  'fr'
)
on conflict (id) do nothing;

-- --- CLIENTS ---------------------------------------------------------------
insert into clients (id, firm_id, type, display_name, email, phone, locale)
values
  (
    '33333333-3333-3333-3333-333333333333',
    '22222222-2222-2222-2222-222222222222',
    'individual',
    'Jean-François Bouchard',
    'jf.bouchard@example.com',
    '+15145551001',
    'fr'
  ),
  (
    '44444444-4444-4444-4444-444444444444',
    '22222222-2222-2222-2222-222222222222',
    'business',
    'Boulangerie du Quartier Inc.',
    'compta@boulangerieduquartier.example.com',
    '+15145551002',
    'fr'
  )
on conflict (id) do nothing;
