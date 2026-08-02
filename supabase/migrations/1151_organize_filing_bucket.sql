-- AI Organize: a fifth suggestion kind — "filing".
--
-- Founder direction (2026-08-02): Luna should organize into the folders the
-- firm CREATED as well, not just the automatic year/category structure. A
-- filing suggestion proposes moving a document into one of the client's own
-- folders, matched purely by name ("Hydro bill 2026.pdf" → the client's
-- "Bookkeeping & business" folder). Same contract as every other bucket:
-- propose-only, human approves, executed through the same action manual
-- filing uses.
--
-- The bucket column was constrained to the original four kinds, so the
-- constraint is rebuilt with the fifth. Data unchanged.

alter table organize_suggestions
  drop constraint if exists organize_suggestions_bucket_check;
alter table organize_suggestions
  add constraint organize_suggestions_bucket_check
  check (bucket in ('low_confidence', 'misfile', 'duplicate', 'unprocessed', 'filing'));
