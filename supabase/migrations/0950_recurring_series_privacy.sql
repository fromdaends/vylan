-- 0950_recurring_series_privacy.sql
--
-- Close two privacy gaps on recurring_series before anything lists them.
--
-- WHY NOW: nothing in the app has ever listed recurring series — the only way
-- to see one is to open an engagement it created and click into Repeat. Both
-- gaps below are therefore LATENT today. The new /repeating screen is the
-- first firm-wide list of series, so it is the thing that would expose them.
-- Fixing the policies is part of shipping that screen, not a separate project.
--
-- GAP 1 — a private ENGAGEMENT's title leaks via its series.
--   recurring_series_select (0810) gates on client_is_private(client_id) ONLY.
--   It never consults engagement_is_private(). But 0850 added PER-ENGAGEMENT
--   privacy on a SHARED client, and src/lib/recurring/enable.ts copies the
--   engagement's title verbatim into recurring_series.title. So a private
--   engagement on a non-private client produces a series row whose title is
--   readable by every staff member.
--
-- GAP 2 — recurring_series_update was never privacy-tightened.
--   0770 created it as a bare `firm_id = current_firm_id()` on both arms and
--   no later migration touched it, so 0810/0850 tightened reads while leaving
--   writes open. A staff member cannot READ a private client's series (so they
--   cannot discover its id), which makes this a blind-write gap rather than a
--   listing leak — but the /repeating screen adds new write paths, so it gets
--   closed properly rather than relying on the app layer alone.
--
-- NOTE on the null case: source_engagement_id is ON DELETE SET NULL, so a
-- series can outlive the engagement it was born from. engagement_is_private
-- (null) matches no row and coalesces to false — i.e. "not private", which is
-- the right answer: with the source engagement gone there is no engagement
-- privacy left to inherit, and the client term still applies.
--
-- Unlike clients/engagements, recurring_series has NO is_private column of its
-- own — its privacy is entirely derived from its parents. So there is no
-- owner-only-settable flag to preserve here, and mirroring the same terms onto
-- the UPDATE arms is safe: it only ever narrows who may write.

drop policy if exists recurring_series_select on public.recurring_series;
create policy recurring_series_select on public.recurring_series
  for select using (
    firm_id = public.current_firm_id()
    and (
      public.current_user_is_owner()
      or (
        not public.client_is_private(client_id)
        and not public.engagement_is_private(source_engagement_id)
      )
    )
  );

drop policy if exists recurring_series_update on public.recurring_series;
create policy recurring_series_update on public.recurring_series
  for update using (
    firm_id = public.current_firm_id()
    and (
      public.current_user_is_owner()
      or (
        not public.client_is_private(client_id)
        and not public.engagement_is_private(source_engagement_id)
      )
    )
  )
  with check (
    firm_id = public.current_firm_id()
    and (
      public.current_user_is_owner()
      or (
        not public.client_is_private(client_id)
        and not public.engagement_is_private(source_engagement_id)
      )
    )
  );

-- The occurrence ledger already cascades correctly through the definer helper
-- series_is_private(series_id) (0810), which reaches the client. It does NOT
-- need the engagement term: an occurrence carries no title or client-derived
-- text of its own — only a period key and an engagement id, and the engagement
-- it points at is independently gated by engagements_all (0850).

comment on policy recurring_series_select on public.recurring_series is
  'Firm-scoped. Staff additionally cannot see a series whose CLIENT is private (0810) or whose SOURCE ENGAGEMENT is private (0850/0950) — the latter matters because the series copies the engagement title verbatim.';
