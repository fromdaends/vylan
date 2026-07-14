-- Move any reminder preset saved by a pre-migration preview deployment out of
-- the compatibility JSON container and into its dedicated firm column.

update public.firms
set
  default_reminder_settings = business_hours -> 'default_reminder_settings',
  business_hours = business_hours - 'default_reminder_settings'
where default_reminder_settings is null
  and jsonb_typeof(business_hours -> 'default_reminder_settings') = 'object';
