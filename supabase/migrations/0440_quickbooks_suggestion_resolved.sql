-- QuickBooks transaction suggestions — Stage 4, Phase 1 (editable drafts).
--
-- The accountant can now REVIEW a draft and pick the real vendor/customer,
-- account, and tax code from their connected QuickBooks lists. Their picks are
-- stored separately from the AI's suggestion (which the Refresh button can
-- regenerate at any time) so editing and re-generating never clobber each other.
--
--   resolved     — the accountant's chosen mapping (jsonb: party/account/taxCode
--                  refs), null until they touch it. This is what Stage 5 will
--                  eventually post; the AI `suggestion` is only the starting point.
--   reviewed_by  — who last edited the draft.
--   reviewed_at  — when.
--
-- Still READ-ONLY on QuickBooks. Writes go through the service role (the table
-- has no authenticated write grant); the existing table-level SELECT grant from
-- 0430 already covers these new columns for firm members. Additive + reversible.

alter table quickbooks_transaction_suggestions
  add column if not exists resolved jsonb,
  add column if not exists reviewed_by uuid references auth.users(id),
  add column if not exists reviewed_at timestamptz;

-- Merge ONE field of the accountant's picks atomically, so two quick edits to
-- different fields (party then account) can't clobber each other via a
-- read-modify-write race. The UPDATE takes a row lock and re-reads `resolved`,
-- so `resolved || patch` always sees the latest committed value. NOT security
-- definer: it runs with the caller's rights, and the service role (which has the
-- table's write rights — authenticated does not) is the only caller, so an
-- authenticated user can never use it to write the table.
create or replace function public.merge_qbo_resolved(
  p_file_id uuid,
  p_patch jsonb,
  p_reviewer uuid
) returns void
language sql
as $$
  update quickbooks_transaction_suggestions
  set resolved = coalesce(resolved, '{}'::jsonb) || p_patch,
      reviewed_by = p_reviewer,
      reviewed_at = now(),
      updated_at = now()
  where uploaded_file_id = p_file_id;
$$;
