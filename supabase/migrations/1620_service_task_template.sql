-- THE SPINE: a service knows what work it implies.
--
-- Canopy's own description of a Service Item is "What's included, How it's
-- priced, THE TASKS YOU'LL PERFORM, The terms clients agree to, Any usage
-- limits" — and: "Service Items link to these templates, and when a client
-- signs, all associated tasks are automatically created."
--
-- Vylan had every piece of that and none of the wiring. `firm_services` (1480)
-- held a name, a price, a frequency and a tax rate — a price tag that knew
-- nothing about the work. `task_templates` (1570) held the work and knew
-- nothing about what it was sold as. Selling "AP/AR Management" and then
-- separately remembering to apply the matching task template is the manual step
-- this removes, and it is the founder's own conclusion after reading Canopy's
-- three-tier article: "we need to build the actual foundation properly first."
--
-- It was flagged twice before and never decided — once in the service-vs-
-- engagement-items notes, and once by the session that built the workflow
-- engine: "Canopy's model points at convergence (an engagement/service item
-- POINTS AT a task template). Worth a founder decision before either grows."
--
-- ── A LIVE LINK HERE, A COPY ON USE ────────────────────────────────────────
--
-- This column is a REFERENCE, on purpose, and it is the one place in this
-- feature that is: the catalogue should stay current, so improving a task
-- template improves what every FUTURE engagement gets. The moment the service
-- lands on a real engagement the tasks are COPIED onto it, and that engagement's
-- work stops tracking the template — the same copy-on-use rule as the priced
-- lines and the client requests, for the same reason: editing your catalogue
-- must never rewrite a job already under way.
--
-- ON DELETE SET NULL: retiring a task template must not take the service down
-- with it. The service keeps selling; it simply stops carrying work until
-- somebody points it at another template.

alter table if exists public.firm_services
  add column if not exists task_template_id uuid
    references public.task_templates(id) on delete set null;

create index if not exists firm_services_task_template_idx
  on public.firm_services (task_template_id)
  where task_template_id is not null;

comment on column public.firm_services.task_template_id is
  'The work this service implies (1570). A LIVE reference so the catalogue stays current; the tasks are COPIED onto an engagement when the service is used, so editing the template never rewrites a job already under way. Null = a service that carries no work.';
