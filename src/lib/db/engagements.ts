import { cache } from "react";
import { isMissingSchema } from "@/lib/db/quickbooks";
import { isBillingTiming, type EngagementItemDraft } from "@/lib/engagements/items";
import { customAlphabet } from "nanoid";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import { DELETED_RETENTION_DAYS } from "@/lib/engagements/lifecycle";
import type { EngagementStage } from "@/lib/engagements/stage";
import { buildRequestItemRow } from "@/lib/engagements/request-item-row";
import type { EngagementType, TemplateItem } from "./templates";
import type { ReminderSettings } from "@/lib/reminder-settings";

export type EngagementStatus =
  | "draft"
  | "sent"
  | "in_progress"
  | "complete"
  | "cancelled";

export type Engagement = {
  id: string;
  firm_id: string;
  /** Acceptance (1640). Null = not accepted, or predates the accept step —
   *  never read as agreement. */
  accepted_at?: string | null;
  /** 'client' = they signed it. 'firm' = somebody here recorded an agreement
   *  reached elsewhere. Not interchangeable. */
  accepted_by?: "client" | "firm" | null;
  /** When work was allowed to begin — a separate decision from acceptance. */
  activated_at?: string | null;
  /**
   * Sent AS a proposal: the client must agree before anything else (1650/1660).
   *
   * Already selected by `select("*")` and already the flag the portal branches
   * on; it simply was not declared here, so every reader outside portal.ts had
   * to cast to reach it. Optional because a pre-1650 row has no column, and
   * absent must read as "not a proposal" — the safe direction, since the whole
   * proposal flow is gated on it being explicitly true.
   */
  requires_acceptance?: boolean | null;
  /**
   * What the proposal says is due the moment the client accepts (1680). Integer
   * cents; NULL means no deposit, which is not the same as 0.
   */
  deposit_cents?: number | null;
  client_id: string;
  title: string;
  type: EngagementType;
  status: EngagementStatus;
  due_date: string | null;
  sent_at: string | null;
  completed_at: string | null;
  magic_token: string | null;
  magic_expires_at: string | null;
  assigned_user_id: string | null;
  reminders_paused: boolean;
  reminder_settings?: ReminderSettings;
  // Per-engagement AI toggle (migration 0340). When false, no document uploaded
  // to this engagement is sent to the AI. Defaults true. Optional on the type so
  // reads survive the pre-migration window (column absent → undefined → treated
  // as ON everywhere via the `=== false` checks).
  ai_enabled?: boolean;
  // Workflow snapshot + confirm-gate latches (migration 1560). Optional so
  // reads survive the pre-migration window. Null/absent = no workflow — the
  // legacy stage resolver applies unchanged. Parse with parseWorkflowSnapshot
  // / parseStageGates (src/lib/workflow/definition.ts); never read raw.
  workflow?: unknown;
  stage_gates?: unknown;
  // Invoice automation (migration 0590). How/whether the client's invoice is
  // sent automatically at completion: 'off' (manual, default), 'on_completion'
  // (send when marked complete), 'delayed' (send invoice_delay_days days after).
  // invoice_amount_cents is the amount to bill, captured at setup. All optional
  // on the type so reads survive the pre-migration window (column absent →
  // undefined → treated as 'off' / no amount).
  invoice_auto_mode?: "off" | "on_acceptance" | "on_completion" | "delayed";
  invoice_delay_days?: number | null;
  invoice_amount_cents?: number | null;
  // Deliverables-lock preference (migration 0610). Gates the Final documents
  // when the invoice is unpaid; also the fallback the lock uses before a deferred
  // invoice row exists.
  invoice_locks_deliverables?: boolean;
  invoice_description?: string | null;
  // Workflow stage (migration 0690). WHERE the engagement is in the firm's
  // process — a third axis, orthogonal to `status` (lifecycle) and to
  // archived_at / deleted_at (the shelf). NULL = no workflow position (a draft
  // hasn't been sent; a cancelled engagement was abandoned), and every reader
  // then falls back to the status pill.
  //
  // NOT authoritative: src/lib/engagements/stage.ts resolves the stage from the
  // engagement's real contents and stage-sync.ts caches the answer here on every
  // relevant event, so a stale value self-heals on the next one. Never compute a
  // stage FROM this column.
  //
  // All optional on the type so reads survive the pre-migration window (column
  // absent → undefined → treated as "no stage" everywhere).
  stage?: EngagementStage | null;
  stage_updated_at?: string | null;
  // Append-only audit log: [{ stage, at, triggered_by }] where triggered_by is
  // "auto" or a user id. Typed as unknown — parseStageHistory validates it.
  stage_history?: unknown;
  // The "Start preparation" latch — the one transition with no other trace in
  // the data. Everything else the resolver derives from what the engagement
  // contains.
  preparation_started_at?: string | null;
  // Recurring series linkage (migration 0770): which series spawned (or
  // adopted) this engagement, and for which period ('2027-03' / '2027-Q1' /
  // '2027'). Optional so reads survive the pre-migration window (column
  // absent → undefined → treated as "not recurring" everywhere).
  series_id?: string | null;
  series_period?: string | null;
  // Per-engagement "Private to me" (migration 0850). When true the engagement +
  // its children are hidden from STAFF, visible to owners — enforced in RLS.
  // Optional on the type so reads survive the pre-migration window (column
  // absent → undefined → read as `engagement.is_private ?? false` = public).
  is_private?: boolean;
  created_at: string;
  // Lifecycle (migration 0139). archive = hidden from active views, reversible
  // anytime; soft-delete = 30-day recoverable window before the purge cron.
  archived_at: string | null;
  archived_by_user_id: string | null;
  deleted_at: string | null;
  deleted_by_user_id: string | null;
};

/**
 * The NAMES of every engagement's priced service lines, batched.
 *
 * This is what Canopy's "Service items" column actually shows — "Bookkeeping
 * Monthly", "Tax Prep, Payroll" — and since #1274 Vylan has the same rows
 * (engagement_items, migration 1450). Before that the list column could only
 * show the engagement's TYPE, which is one of four fixed values and reads
 * "Custom" on most real work.
 *
 * One query for the whole list, not one per row: this feeds a table that can be
 * a hundred engagements long, and a query per row is the N+1 the perf sweep
 * spent a day removing everywhere else.
 *
 * Ordered by order_index so the names read in the order the accountant put them
 * on the proposal — the first one is the headline service, and a column that
 * truncates to "+2 more" must truncate the RIGHT two.
 */
/**
 * One engagement's priced service lines, in proposal order.
 *
 * The single-row twin of listItemNamesByEngagement, for the engagement's own
 * page — which needs one job's lines, not every job's.
 */
export async function listEngagementItems(
  engagementId: string,
): Promise<EngagementItemDraft[]> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("engagement_items")
    .select(
      "id, name, description, service_id, rate_cents, rate_type, billing_frequency, tax_pct, billing_timing, billing_start_date, order_index",
    )
    .eq("engagement_id", engagementId)
    .order("order_index", { ascending: true });
  if (error) {
    // Deploy-ahead safe, as everywhere else here: an engagement page that 500s
    // because 1450 is not applied is far worse than one with no Services list.
    if (isMissingSchema(error)) return [];
    throw error;
  }
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: String(row.id),
      name: String(row.name ?? "").trim(),
      description: (row.description as string | null) ?? null,
      // Provenance only — never read through to the catalogue for a price. A
      // line's numbers are what the client agreed to, and editing the service
      // afterwards must not rewrite an agreement.
      serviceId: (row.service_id as string | null) ?? null,
      rateCents: (row.rate_cents as number | null) ?? null,
      rateType: (row.rate_type as EngagementItemDraft["rateType"]) ?? "item",
      billingFrequency:
        (row.billing_frequency as EngagementItemDraft["billingFrequency"]) ??
        "once",
      taxPct: (row.tax_pct as number | null) ?? null,
      // NULL stays NULL rather than being defaulted here: "no timing recorded"
      // and "bills on acceptance" are different facts, and every reader has its
      // own right answer for the absent case.
      billingTiming: isBillingTiming(row.billing_timing)
        ? row.billing_timing
        : null,
      billingStartDate: (row.billing_start_date as string | null) ?? null,
    };
  });
}

export async function listItemNamesByEngagement(): Promise<
  Map<string, string[]>
> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("engagement_items")
    .select("engagement_id, name, order_index")
    .order("order_index", { ascending: true });
  if (error) {
    // Deploy-ahead safe, the same rule the rest of this file follows: before
    // 1450 is applied the table does not exist, and a list that 500s is far
    // worse than one whose Service column falls back to the old type label.
    if (isMissingSchema(error)) return new Map();
    throw error;
  }
  const out = new Map<string, string[]>();
  for (const row of (data ?? []) as Array<{
    engagement_id: string;
    name: string | null;
  }>) {
    const name = row.name?.trim();
    // An unnamed line is a draft the accountant has not filled in. Showing a
    // blank in a list of services is worse than showing one fewer.
    if (!name) continue;
    out.set(row.engagement_id, [...(out.get(row.engagement_id) ?? []), name]);
  }
  return out;
}

export async function setRemindersPaused(
  id: string,
  paused: boolean,
): Promise<void> {
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from("engagements")
    .update({ reminders_paused: paused })
    .eq("id", id);
  if (error) throw error;
}

export async function updateEngagementReminderAutomation(
  id: string,
  settings: ReminderSettings,
  paused: boolean,
): Promise<void> {
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from("engagements")
    .update({ reminder_settings: settings, reminders_paused: paused })
    .eq("id", id);
  if (error) throw error;
}

export async function updateEngagementInvoiceAutomation(
  id: string,
  input: {
    mode: "off" | "on_completion" | "delayed";
    delayDays: number | null;
    amountCents: number | null;
    description: string | null;
    locksDeliverables: boolean;
  },
): Promise<boolean> {
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from("engagements")
    .update({
      invoice_auto_mode: input.mode,
      invoice_delay_days: input.delayDays,
      invoice_amount_cents: input.amountCents,
      invoice_description: input.description,
      invoice_locks_deliverables: input.locksDeliverables,
    })
    .eq("id", id);
  if (error) {
    console.error("[engagements] update invoice automation failed:", error);
    return false;
  }
  return true;
}

// Set (or clear) the engagement's deliverables-lock preference (migration 0610).
// Used by the accountant's "unlock without payment" when no invoice row exists yet
// (a deferred invoice that hasn't fired) so the fallback lock is lifted. RLS-
// scoped; returns false on failure (e.g. pre-0610) so the caller can skip logging.
export async function setEngagementInvoiceLock(
  id: string,
  value: boolean,
): Promise<boolean> {
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from("engagements")
    .update({ invoice_locks_deliverables: value })
    .eq("id", id);
  if (error) {
    console.error("[engagements] setEngagementInvoiceLock failed:", error);
    return false;
  }
  return true;
}

// Change (or clear) the due date after creation — first added for the
// Assistant panel's phase-3 actions. Callers on a SENT engagement must also
// cancel + reschedule the reminder jobs, since the "overdue" reminder was
// enqueued from the original due date (see src/lib/reminders.ts).
export async function updateEngagementDueDate(
  id: string,
  dueDate: string | null,
): Promise<void> {
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from("engagements")
    .update({ due_date: dueDate })
    .eq("id", id);
  if (error) throw error;
}

const tokenAlphabet =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const generateMagicToken = customAlphabet(tokenAlphabet, 43);

export function newMagicToken(): string {
  return generateMagicToken();
}

// Lifecycle scope for a listing (orthogonal to `status`):
//   - "active"   (default): not archived, not deleted — the day-to-day board.
//   - "archived": manually archived, not deleted.
//   - "deleted":  soft-deleted within the 30-day window (Recently Deleted).
//   - "any":      no lifecycle filter (e.g. a single-client history view).
// Defaulting to "active" means every existing caller automatically stops
// surfacing archived / deleted engagements.
export type EngagementScope = "active" | "archived" | "deleted" | "any";

// The real fetch, React.cache'd on PRIMITIVE keys. cache() compares object
// arguments by reference, so caching the public function directly would never
// dedupe two call sites both asking for `{ scope: "active" }` — which is
// exactly what /clients did (its own listEngagements() plus the one inside
// loadEngagementSignals), paying the full-table query twice per render. Every
// caller is a page-render read (verified: nothing writes engagements and
// re-lists within one request), so per-request memoization is safe.
const listEngagementsCached = cache(async function _listEngagements(
  clientId: string | null,
  status: EngagementStatus | "all" | null,
  scope: EngagementScope,
): Promise<Engagement[]> {
  const supabase = await getServerSupabase();
  let q = supabase.from("engagements").select("*");
  if (clientId) q = q.eq("client_id", clientId);
  if (status && status !== "all") {
    q = q.eq("status", status);
  }
  if (scope === "active") {
    q = q.is("deleted_at", null).is("archived_at", null);
  } else if (scope === "archived") {
    q = q.is("deleted_at", null).not("archived_at", "is", null);
  } else if (scope === "deleted") {
    // Recently Deleted = soft-deleted within the retention window; older rows
    // are awaiting / mid-purge and must not surface.
    const cutoff = new Date(
      Date.now() - DELETED_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    q = q.not("deleted_at", "is", null).gte("deleted_at", cutoff);
  }
  // "any": no lifecycle filter at all.
  q = q.order("created_at", { ascending: false });
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Engagement[];
});

export async function listEngagements(filters?: {
  client_id?: string;
  status?: EngagementStatus | "all";
  scope?: EngagementScope;
}): Promise<Engagement[]> {
  return listEngagementsCached(
    filters?.client_id ?? null,
    filters?.status ?? null,
    filters?.scope ?? "active",
  );
}

export async function getEngagement(id: string): Promise<Engagement | null> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("engagements")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as Engagement) ?? null;
}

export type CreateEngagementInput = {
  client_id: string;
  title: string;
  type: EngagementType;
  due_date: string | null;
  // Structured tax year (migration 0900). Optional; null = not set.
  tax_year?: number | null;
  // "AI Analyze" switch from the engagement builder. Defaults true upstream.
  ai_enabled: boolean;
  // Invoice automation (migration 0590). 'off' = no automatic invoice.
  invoice_auto_mode?: "off" | "on_acceptance" | "on_completion" | "delayed";
  /**
   * What the proposal says is due the moment the client accepts (1680).
   *
   * Its OWN column rather than only the frozen proposal jsonb, because it has
   * to be invoiced — a number inside a snapshot cannot be charged.
   */
  deposit_cents?: number | null;
  invoice_delay_days?: number | null;
  invoice_amount_cents?: number | null;
  // Deliverables lock preference + description (migration 0610), carried onto an
  // invoice created LATER by the automation (on_completion / delayed).
  invoice_locks_deliverables?: boolean;
  invoice_description?: string | null;
  // Priced service lines — the scope (migration 1450). Optional so every
  // existing caller is unaffected; absent means "no priced scope", which is
  // every engagement created before this shipped.
  // Canopy's step 1 (migration 1510). start_date is WHEN THE WORK BEGINS,
  // distinct from due_date which is when it is owed.
  start_date?: string | null;
  /** The client-facing document, frozen. Its presence is what makes the portal
   *  ask the client to agree before anything else. */
  proposal?: Record<string, unknown> | null;
  intro_message?: string | null;
  service_items?: {
    name: string;
    service_id?: string | null;
    description: string | null;
    rate_cents: number | null;
    rate_type: "item" | "hour";
    billing_frequency: "once" | "weekly" | "monthly" | "quarterly" | "yearly";
    tax_pct: number | null;
    /** WHEN it bills, inherited from its billing block (1740). */
    billing_timing?:
      | "on_acceptance"
      | "on_completion"
      | "engagement_start"
      | "custom_date"
      | null;
    billing_start_date?: string | null;
  }[];
  reminder_settings: ReminderSettings;
  // Who the work belongs to from the moment it exists. Absent (or null) keeps
  // the old behaviour of assigning the creator. Before this, creating work for
  // somebody else was always TWO steps — create it, then hand it over — which
  // is also why the handoff note existed for a case that shouldn't need one.
  // The caller is responsible for validating the id is an active firm member;
  // the RLS policy can't do it (assigned_user_id has no FK constraint to a
  // firm-scoped view).
  assigned_user_id?: string | null;
  // Workflow snapshot (migration 1560) — a WorkflowSnapshot built by the
  // create action (definition copied from the template or family default,
  // assignees resolved to user ids). Written best-effort AFTER the insert so
  // a pre-1560 environment costs the automation, never the engagement.
  workflow?: unknown;
  items: TemplateItem[];
};

// A write that referenced a column the current DB doesn't have yet (a migration
// deployed in code but not applied to this environment). PostgREST reports a
// schema-cache miss (PGRST204); Postgres proper reports undefined_column (42703).
// Match on these exact codes ONLY — deliberately NOT on the message text, so an
// unrelated failure that merely mentions the column can never trigger the
// retry-without-ai_enabled and silently create the engagement with AI on when
// the accountant chose off.
function isUnknownColumnError(
  err: { code?: string | null } | null,
): boolean {
  return err?.code === "PGRST204" || err?.code === "42703";
}

export async function createEngagementWithItems(
  input: CreateEngagementInput,
): Promise<Engagement> {
  const supabase = await getServerSupabase();
  const u = await getCurrentUser();
  if (!u) throw new Error("Not authenticated");
  if (!u.firm_id) throw new Error("No firm for user");

  // New engagements default to PRIVATE when the firm opted into "private by
  // default" AND the creator is an OWNER (staff can't set is_private — the
  // engagements_all WITH CHECK would reject the insert). Migration-gated + fails
  // open: absent column/flag → public (today's behavior). Reads through the
  // request-cached getCurrentUser/getCurrentFirm — no extra round trips on a
  // request that already resolved them.
  let defaultPrivate = false;
  if (u.role === "owner") {
    const f = await getCurrentFirm();
    defaultPrivate =
      (f as { clients_private_by_default?: boolean } | null)
        ?.clients_private_by_default === true;
  }
  // Included only when it should be TRUE, so a pre-0850 DB (no is_private column)
  // only hits the tiered retry for owners with the switch on — and the retry
  // drops it, creating the engagement public (fail-open).
  const privateCol = defaultPrivate ? { is_private: true } : {};
  // tax_year (0900) rides along only when the accountant actually set one, so
  // a no-year engagement never depends on the new column; when it IS included
  // and the column is missing, the first retry tier below drops it (the year
  // is then simply not stored — fail-open, title scrape still covers filing).
  const taxYearCol =
    input.tax_year != null ? { tax_year: input.tax_year } : {};
  // Included only when SET, so a pre-1510 database only hits the retry ladder
  // for an engagement that actually used them — and the retry drops them, which
  // creates the engagement without a start date rather than not at all.
  // The frozen proposal + the flag that makes the portal ask (1650/1660).
  // Included ONLY when there is a proposal, so an engagement without one never
  // depends on the new columns and never asks a client to agree to nothing.
  const proposalCols = input.proposal
    ? { proposal: input.proposal, requires_acceptance: true }
    : {};
  const detailCols1510 = {
    ...(input.start_date != null ? { start_date: input.start_date } : {}),
    ...(input.intro_message != null
      ? { intro_message: input.intro_message }
      : {}),
  };

  // Base row (valid in every environment). ai_enabled (migration 0340) is added
  // separately so creation survives the deploy→migrate window: if that column
  // doesn't exist yet, including it would fail the WHOLE insert and break
  // engagement creation. Try WITH it; only on a missing-column error retry
  // WITHOUT it. Fail-open — until the migration lands the toggle has no effect
  // (AI stays on, the default), matching the read side which also defaults ON.
  const baseRow = {
    firm_id: u.firm_id,
    client_id: input.client_id,
    title: input.title,
    type: input.type,
    status: "draft",
    due_date: input.due_date,
    // The creator is the DEFAULT assignee-of-record (accountability, not access
    // control — every firm member still sees every engagement), but the caller
    // may name someone else so work can be created already handed over.
    assigned_user_id: input.assigned_user_id ?? u.id,
    assigned_at: new Date().toISOString(),
  };
  // Invoice-automation columns (migration 0590) ride along ONLY when the
  // accountant actually turned automation on, so a normal 'off' engagement
  // never depends on the new columns and creation keeps working pre-0590. When
  // they ARE included and the column is missing, the tiered retry below drops
  // them (invoice automation is simply inert until the migration lands).
  const automationOn =
    !!input.invoice_auto_mode && input.invoice_auto_mode !== "off";
  // Only when there IS one: a null would be indistinguishable from "column
  // absent" in the retry ladder, and an engagement with no deposit must not
  // depend on 1680 having been applied.
  const depositCol =
    typeof input.deposit_cents === "number" && input.deposit_cents > 0
      ? { deposit_cents: input.deposit_cents }
      : {};
  // 0590 automation columns and the 0610 lock/description columns are kept
  // separate so the tiered retry can drop ONLY the newest (0610) columns without
  // losing the automation (0590) when just 0610 hasn't been applied yet.
  const invoiceCols590 = automationOn
    ? {
        invoice_auto_mode: input.invoice_auto_mode,
        invoice_delay_days: input.invoice_delay_days ?? null,
        invoice_amount_cents: input.invoice_amount_cents ?? null,
      }
    : {};
  // Persist the lock preference + description whenever the accountant set them —
  // not only for the deferred (automation) modes but also for a "create now"
  // invoice (auto_mode 'off'), so the deliverables-lock fallback can gate the
  // finished work even if the create-now invoice row failed to record.
  const wants610 =
    automationOn ||
    input.invoice_locks_deliverables === true ||
    (input.invoice_description != null && input.invoice_description !== "");
  const invoiceCols610 = wants610
    ? {
        invoice_locks_deliverables: input.invoice_locks_deliverables ?? false,
        invoice_description: input.invoice_description ?? null,
      }
    : {};
  const reminderCols660 = {
    reminder_settings: input.reminder_settings,
  };
  let { data: engagement, error: engErr } = await supabase
    .from("engagements")
    .insert({
      ...baseRow,
      ai_enabled: input.ai_enabled,
      ...invoiceCols590,
      ...invoiceCols610,
      ...reminderCols660,
      ...privateCol,
      ...taxYearCol,
      // 1510 is the newest set; if it's missing the FIRST retry tier below
      // (which omits it) still creates the engagement — fail-open.
      ...detailCols1510,
      // 1650/1660. Dropped by the same first retry tier on a database that
      // does not have them: the engagement is created WITHOUT a proposal
      // rather than not at all, and the portal falls back to its normal view.
      ...proposalCols,
      // 1680, the newest of all. Dropped by the same first tier — the
      // engagement is created without a deposit rather than not at all, and
      // nothing is charged, which is the honest outcome on a database that
      // cannot record one.
      ...depositCol,
    })
    .select("*")
    .single();
  // Retry tiers, dropping the NEWEST column-set first so an unknown column never
  // takes co-located data down with it: without 0850 (is_private), then 0660,
  // then 0610, then 0590, then ai_enabled (a very old env missing 0340 too).
  if (engErr && isUnknownColumnError(engErr)) {
    // Drop the NEWEST set first: 1510 (start_date, intro_message) and tax_year
    // (0900). Everything older is kept.
    ({ data: engagement, error: engErr } = await supabase
      .from("engagements")
      .insert({
        ...baseRow,
        ai_enabled: input.ai_enabled,
        ...invoiceCols590,
        ...invoiceCols610,
        ...reminderCols660,
        ...privateCol,
      })
      .select("*")
      .single());
  }
  if (engErr && isUnknownColumnError(engErr)) {
    // Drop ONLY is_private (0850) — keep reminder_settings (0660) etc., since
    // 0660 is necessarily present whenever only 0850 is missing.
    ({ data: engagement, error: engErr } = await supabase
      .from("engagements")
      .insert({
        ...baseRow,
        ai_enabled: input.ai_enabled,
        ...invoiceCols590,
        ...invoiceCols610,
        ...reminderCols660,
      })
      .select("*")
      .single());
  }
  if (engErr && isUnknownColumnError(engErr)) {
    ({ data: engagement, error: engErr } = await supabase
      .from("engagements")
      .insert({
        ...baseRow,
        ai_enabled: input.ai_enabled,
        ...invoiceCols590,
        ...invoiceCols610,
      })
      .select("*")
      .single());
  }
  if (engErr && isUnknownColumnError(engErr)) {
    ({ data: engagement, error: engErr } = await supabase
      .from("engagements")
      .insert({ ...baseRow, ai_enabled: input.ai_enabled, ...invoiceCols590 })
      .select("*")
      .single());
  }
  if (engErr && isUnknownColumnError(engErr)) {
    ({ data: engagement, error: engErr } = await supabase
      .from("engagements")
      .insert({ ...baseRow, ai_enabled: input.ai_enabled })
      .select("*")
      .single());
  }
  if (engErr && isUnknownColumnError(engErr)) {
    ({ data: engagement, error: engErr } = await supabase
      .from("engagements")
      .insert(baseRow)
      .select("*")
      .single());
  }
  if (engErr || !engagement) throw engErr ?? new Error("create_failed");

  // Workflow snapshot (1560), deliberately OUTSIDE the tiered insert above: a
  // missing column (pre-1560) or a write hiccup costs the automation — the
  // engagement then simply runs legacy — never the engagement itself.
  if (input.workflow != null) {
    const { error: wfErr } = await supabase
      .from("engagements")
      .update({ workflow: input.workflow })
      .eq("id", (engagement as { id: string }).id);
    if (wfErr && !isUnknownColumnError(wfErr)) {
      console.error("[engagements] workflow snapshot write failed:", wfErr);
    }
  }

  if (input.items.length > 0) {
    // Shared with addItemToEngagement so the two ways an item is born cannot
    // fill different columns — see src/lib/engagements/request-item-row.ts.
    const rows = input.items.map((item, idx) =>
      buildRequestItemRow(
        engagement.id,
        {
          label: item.label_en,
          label_fr: item.label_fr,
          description: item.description_en,
          description_fr: item.description_fr,
          doc_type: item.doc_type,
          required: item.required,
        },
        idx,
      ),
    );
    const { error: itemsErr } = await supabase
      .from("request_items")
      .insert(rows);
    if (itemsErr) throw itemsErr;
  }

  // The priced scope (migration 1450). Written AFTER the engagement and its
  // checklist, and deliberately FAIL-SOFT: a missing table means 1450 is not
  // applied yet, and an engagement created without its scope is still a valid,
  // usable engagement — exactly how it behaved before this shipped. Losing the
  // whole engagement because a new table is not there yet would be far worse
  // than losing the prices, which the accountant can re-enter on its page.
  const scope = input.service_items ?? [];
  if (scope.length > 0) {
    const { error: scopeErr } = await supabase.from("engagement_items").insert(
      scope.map((it, idx) => ({
        engagement_id: (engagement as Engagement).id,
        firm_id: u.firm_id,
        name: it.name,
        service_id: it.service_id ?? null,
        description: it.description,
        rate_cents: it.rate_cents,
        rate_type: it.rate_type,
        billing_frequency: it.billing_frequency,
        tax_pct: it.tax_pct,
        order_index: idx,
        // WHEN it bills (1740). Dropped by the retry below on a pre-1740
        // database, exactly like every other newest-column-first field here —
        // the prices still save, they simply lose their timing until the
        // migration lands.
        ...(it.billing_timing != null
          ? { billing_timing: it.billing_timing }
          : {}),
        ...(it.billing_start_date != null
          ? { billing_start_date: it.billing_start_date }
          : {}),
      })),
    );
    // Pre-1740: retry WITHOUT the timing columns. Losing the timing is bad;
    // losing the whole priced scope because a migration has not landed is worse,
    // and this is the same ladder createEngagementWithItems already uses above.
    if (scopeErr && isUnknownColumnError(scopeErr)) {
      const { error: retryErr } = await supabase
        .from("engagement_items")
        .insert(
          scope.map((it, idx) => ({
            engagement_id: (engagement as Engagement).id,
            firm_id: u.firm_id,
            name: it.name,
            service_id: it.service_id ?? null,
            description: it.description,
            rate_cents: it.rate_cents,
            rate_type: it.rate_type,
            billing_frequency: it.billing_frequency,
            tax_pct: it.tax_pct,
            order_index: idx,
          })),
        );
      if (retryErr && !isMissingSchema(retryErr)) throw retryErr;
      if (retryErr) {
        console.warn(
          "[engagements] priced scope not saved — migration 1450 unapplied",
        );
      }
      return engagement as Engagement;
    }
    if (scopeErr && !isMissingSchema(scopeErr)) throw scopeErr;
    if (scopeErr) {
      console.warn(
        "[engagements] priced scope not saved — migration 1450 unapplied",
      );
    }
  }

  return engagement as Engagement;
}

export async function sendEngagement(id: string): Promise<Engagement> {
  const supabase = await getServerSupabase();
  const token = newMagicToken();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 90);
  const { data, error } = await supabase
    .from("engagements")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
      magic_token: token,
      magic_expires_at: expiresAt.toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as Engagement;
}

export async function cancelEngagement(id: string): Promise<void> {
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from("engagements")
    .update({ status: "cancelled" })
    .eq("id", id);
  if (error) throw error;
}

export async function completeEngagement(id: string): Promise<void> {
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from("engagements")
    .update({ status: "complete", completed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function reopenEngagement(id: string): Promise<void> {
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from("engagements")
    .update({ status: "in_progress", completed_at: null })
    .eq("id", id);
  if (error) throw error;
}

// --- ACCEPTANCE (migration 1640) ---------------------------------------------
//
// The step between "we sent it" and "we are doing it", which Vylan could not
// express: `resolveAgreementStatus` has modelled `accepted` since the status
// remodel and NOTHING could reach it.
//
// Three verbs, mirroring Karbon's documented lifecycle
// (Draft -> Waiting for acceptance -> Accepted -> Active -> Ended), because it
// is the most completely documented of the four products researched and the
// only one that spells out what each transition does.

/**
 * Record that the client agreed.
 *
 * `by` is not decoration. 'client' means they signed it; 'firm' is Karbon's
 * "Accept on behalf" — somebody here recording an agreement reached on the
 * phone or on paper. If a dispute ever turns on it, "the client signed" and
 * "we ticked a box saying they agreed" are different claims and must stay
 * distinguishable.
 *
 * Does NOT set status. Acceptance is a fact about the agreement; whether work
 * has begun is a separate fact, and conflating them is what activateEngagement
 * exists to avoid.
 */
export async function acceptEngagement(
  id: string,
  by: "client" | "firm",
): Promise<void> {
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from("engagements")
    .update({ accepted_at: new Date().toISOString(), accepted_by: by })
    // Accepting twice must not move the date — the first agreement is the one
    // that happened.
    .is("accepted_at", null)
    .eq("id", id);
  if (error) throw error;
}

/**
 * Let the work begin. Karbon: Accepted -> Activate, "signalling that work can
 * begin".
 *
 * Guarded on `accepted_at is not null` in the QUERY, not just the UI: activating
 * something nobody agreed to would put an engagement into a state the resolver
 * deliberately refuses to derive, and a guard that lives only in a button is
 * one bad call away from being bypassed.
 */
export async function activateEngagement(id: string): Promise<void> {
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from("engagements")
    .update({ activated_at: new Date().toISOString(), status: "in_progress" })
    .not("accepted_at", "is", null)
    .eq("id", id);
  if (error) throw error;
}

/**
 * Pull a sent engagement back so it can be edited. Karbon's "Revert to Draft",
 * and their own docs are blunt that it is destructive: it "withdraws the
 * engagement from all signatories".
 *
 * So this clears acceptance and activation as well as the send. An engagement
 * that keeps its acceptance while being edited would let a firm change what a
 * client agreed to, after they agreed to it, with the agreement still recorded.
 * That is the one outcome this must make impossible.
 */
export async function revertEngagementToDraft(id: string): Promise<void> {
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from("engagements")
    .update({
      status: "draft",
      sent_at: null,
      accepted_at: null,
      accepted_by: null,
      activated_at: null,
    })
    .eq("id", id);
  if (error) throw error;
}

// --- Lifecycle mutators: archive (reversible, never purged) + soft-delete
// (30-day recoverable window). Rules + permissions live in
// src/lib/engagements/lifecycle.ts; the permanent purge runs in
// src/app/api/cron/purge-deleted-engagements. ---

export async function archiveEngagement(
  id: string,
  userId: string,
): Promise<void> {
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from("engagements")
    .update({
      archived_at: new Date().toISOString(),
      archived_by_user_id: userId,
    })
    .eq("id", id);
  if (error) throw error;
}

export async function unarchiveEngagement(id: string): Promise<void> {
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from("engagements")
    .update({ archived_at: null, archived_by_user_id: null })
    .eq("id", id);
  if (error) throw error;
}

// Soft-delete: recoverable for 30 days, then the purge cron removes it for
// good. OWNER-ONLY — enforced in the server action (canDeleteEngagements).
export async function softDeleteEngagement(
  id: string,
  userId: string,
): Promise<void> {
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from("engagements")
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by_user_id: userId,
    })
    .eq("id", id);
  if (error) throw error;
}

export async function restoreEngagement(id: string): Promise<void> {
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from("engagements")
    .update({ deleted_at: null, deleted_by_user_id: null })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteDraftEngagement(id: string): Promise<void> {
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from("engagements")
    .delete()
    .eq("id", id)
    .eq("status", "draft");
  if (error) throw error;
}

// Permanently delete an engagement of any status. RLS scopes the delete to
// the caller's firm. The FK cascade on request_items / uploaded_files /
// jobs / activity_log removes all related rows, so this can't orphan data.
// Irreversible — callers must confirm with the user first.
export async function deleteEngagement(id: string): Promise<void> {
  const supabase = await getServerSupabase();
  const { error } = await supabase.from("engagements").delete().eq("id", id);
  if (error) throw error;
}
