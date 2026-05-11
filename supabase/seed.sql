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
-- 15 demo clients: mix of individual/business, fr/en, with one pre-archived
-- so the archived-toggle in /clients has something to show.
insert into clients (
  id, firm_id, type, display_name, email, phone, locale,
  external_ref, notes, archived_at
)
values
  ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222',
   'individual', 'Jean-François Bouchard', 'jf.bouchard@example.com',
   '+15145551001', 'fr', 'JFB-2024', 'Locataire avec deux T4', null),
  ('33333333-3333-3333-3333-333333333334', '22222222-2222-2222-2222-222222222222',
   'individual', 'Marie-Claude Pelletier', 'mc.pelletier@example.com',
   '+14185551002', 'fr', null, null, null),
  ('33333333-3333-3333-3333-333333333335', '22222222-2222-2222-2222-222222222222',
   'individual', 'Sébastien Tremblay', 's.tremblay@example.com',
   '+15145551003', 'fr', null, null, null),
  ('33333333-3333-3333-3333-333333333336', '22222222-2222-2222-2222-222222222222',
   'individual', 'Catherine Lavoie', null,
   '+15145551004', 'fr', null, 'Pas de courriel — appeler', null),
  ('33333333-3333-3333-3333-333333333337', '22222222-2222-2222-2222-222222222222',
   'individual', 'Pierre Gagnon', 'p.gagnon@example.com',
   '+14385551005', 'fr', null, null, null),
  ('33333333-3333-3333-3333-333333333338', '22222222-2222-2222-2222-222222222222',
   'individual', 'Anne-Sophie Dubois', 'as.dubois@example.com',
   null, 'fr', null, null, null),
  ('33333333-3333-3333-3333-333333333339', '22222222-2222-2222-2222-222222222222',
   'individual', 'Mathieu Lévesque', 'm.levesque@example.com',
   '+15145551007', 'fr', 'ML-CORP', null, null),
  ('3333333a-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222',
   'individual', 'Emma Wright', 'emma.wright@example.com',
   '+15145551008', 'en', null, 'Anglophone — expat from Toronto', null),
  ('44444444-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222',
   'business', 'Boulangerie du Quartier Inc.', 'compta@boulangerie.example.com',
   '+15145552001', 'fr', 'BQ-INC', null, null),
  ('44444444-4444-4444-4444-444444444445', '22222222-2222-2222-2222-222222222222',
   'business', 'Garage Plamondon Auto', 'compta@garageplamondon.example.com',
   '+14185552002', 'fr', null, 'Tenue de livres mensuelle', null),
  ('44444444-4444-4444-4444-444444444446', '22222222-2222-2222-2222-222222222222',
   'business', 'Café des Arts', 'admin@cafedesarts.example.com',
   '+15145552003', 'fr', null, null, null),
  ('44444444-4444-4444-4444-444444444447', '22222222-2222-2222-2222-222222222222',
   'business', 'Construction Lafleur Inc.', 'compta@lafleurconstruction.example.com',
   '+14505552004', 'fr', 'CL-INC', null, null),
  ('44444444-4444-4444-4444-444444444448', '22222222-2222-2222-2222-222222222222',
   'business', 'Pâtisserie Belle-Anse', 'info@belleanse.example.com',
   '+14185552005', 'fr', null, null, null),
  ('44444444-4444-4444-4444-444444444449', '22222222-2222-2222-2222-222222222222',
   'business', 'Northern Lights Bakery Inc.', 'accounts@northernlights.example.com',
   '+15145552006', 'en', 'NL-INC', 'English-speaking owner', null),
  ('4444444a-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222',
   'business', 'Salon Coiffure Élégance (fermé)', 'ancien@elegance.example.com',
   '+15145552007', 'fr', null, 'Fermé en 2024', now() - interval '6 months')
on conflict (id) do nothing;
