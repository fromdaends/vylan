// THE CROSS-FIRM READ. Service role, read-only, no writes anywhere in this file.
//
// ⚠️ EVERY QUERY HERE BYPASSES RLS. Nothing in this module may be called from a
// route that has not already passed lib/founders/access.ts. The pages do that
// check first and notFound() on failure; if you add a new caller, do the same.
//
// ── DESIGN: FAN OUT WIDE, COUNT IN JS ────────────────────────────────────────
//
// ~20 grouped reads in parallel, each pulling the minimum columns with a hard
// row ceiling, then folded into rows by the pure code in aggregate.ts. The
// reasoning for counting in JS rather than SQL is written there; the reasoning
// for the ceiling is here: a dashboard that silently truncates is worse than no
// dashboard, because a short list reads as "that is all there is". So every
// read that comes back exactly at the cap is REPORTED (`capped`) and rendered
// as a warning in the Health tab.
//
// ── DESIGN: NOTHING HERE MAY THROW ───────────────────────────────────────────
//
// Every read goes through `read()`, which turns any failure — a table that does
// not exist yet because a migration is unapplied, a column added in 1790 on an
// environment still on 1780, a network blip — into an empty array plus a noted
// problem. A founders console that 500s because one optional table is missing
// is a console you stop opening. Missing data shows as zero AND says so.

import { getServiceRoleSupabase } from "@/lib/supabase/server";
import {
  bucketByDay,
  buildFirmRows,
  countBy,
  sinceIso,
  type FirmSources,
} from "@/lib/founders/aggregate";
import { activityCategory, actorLabel } from "@/lib/founders/actions";
import type {
  AdoptionRow,
  CappedRead,
  FeedEvent,
  FirmDetail,
  FirmRow,
  FoundersData,
  HealthSnapshot,
  LeadRow,
  PlatformTotals,
} from "@/lib/founders/types";

/** Row ceiling per read. Vylan's busiest table is in the low thousands; this is
 *  a runaway guard, not a page size. Raise it here, in one place. */
const CAP = 20_000;

/** How far back the "pulse" columns and the charts look. */
const WINDOW_DAYS = 30;

/** How many events the cross-firm feed shows. Deliberately generous — this is
 *  the tab whose whole job is "as much activity as possible". */
const FEED_LIMIT = 400;

type ReadResult<T> = { rows: T[]; capped: boolean; error: string | null };

/**
 * One guarded read. Returns rows, whether the ceiling was hit, and the error
 * text if it failed. NEVER throws.
 */
async function read<T>(
  table: string,
  build: (q: ReturnType<ReturnType<typeof getServiceRoleSupabase>["from"]>) => unknown,
): Promise<ReadResult<T>> {
  try {
    const sb = getServiceRoleSupabase();
    const query = build(sb.from(table)) as PromiseLike<{
      data: T[] | null;
      error: { message: string } | null;
    }>;
    const { data, error } = await query;
    if (error) return { rows: [], capped: false, error: error.message };
    const rows = data ?? [];
    return { rows, capped: rows.length >= CAP, error: null };
  } catch (e) {
    return { rows: [], capped: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Collect the capped reads across a batch, for the Health tab. */
function collectCapped(entries: Array<[string, { capped: boolean }]>): CappedRead[] {
  return entries.filter(([, r]) => r.capped).map(([table]) => ({ table, cap: CAP }));
}

// ── the main load ────────────────────────────────────────────────────────────

export async function loadFoundersData(nowMs: number = Date.now()): Promise<FoundersData> {
  const since = sinceIso(nowMs, WINDOW_DAYS);
  // Signups get a longer lens than the activity window: 30 days of a young
  // product is often a flat line, and the shape of the whole year is the thing
  // a founder actually wants from that chart.
  const signupSince = sinceIso(nowMs, 365);
  const monthStart = `${new Date(nowMs).toISOString().slice(0, 7)}-01`;

  const [
    firms,
    users,
    clients,
    engagements,
    tasks,
    imported,
    finals,
    uploads,
    invoices,
    messages,
    timeEntries,
    automations,
    services,
    templates,
    qbo,
    xero,
    storage,
    calendar,
    aiUsage,
    events,
    feedRows,
    leads,
    jobs,
  ] = await Promise.all([
    read<FirmSources["firms"][number]>("firms", (q) =>
      q
        .select(
          "id, name, plan, is_demo, is_pilot, locale_default, province, created_at, onboarded_at, trial_ends_at, subscription_status, workflows_enabled, time_insights_enabled",
        )
        .order("created_at", { ascending: false })
        .limit(CAP),
    ),
    read<{ id: string; firm_id: string; email: string; name: string | null; display_name: string | null; role: string | null; deactivated_at: string | null; created_at: string }>(
      "users",
      (q) =>
        q
          .select("id, firm_id, email, name, display_name, role, deactivated_at, created_at")
          .limit(CAP),
    ),
    read<{ firm_id: string; archived_at: string | null }>("clients", (q) =>
      q.select("firm_id, archived_at").limit(CAP),
    ),
    read<{ id: string; firm_id: string; status: string | null; deleted_at: string | null; created_at: string; title: string | null; client_id: string | null }>(
      "engagements",
      (q) =>
        q.select("id, firm_id, status, deleted_at, created_at, title, client_id").limit(CAP),
    ),
    read<{ firm_id: string; status: string | null }>("engagement_tasks", (q) =>
      q.select("firm_id, status").limit(CAP),
    ),
    read<{ firm_id: string }>("imported_documents", (q) => q.select("firm_id").limit(CAP)),
    read<{ firm_id: string }>("final_documents", (q) => q.select("firm_id").limit(CAP)),
    // uploaded_files is the ONE document table with no firm_id — it hangs off
    // the engagement (0001). Mapped through the engagements read below rather
    // than dropped: client uploads are the single most meaningful "this firm is
    // really using it" signal there is.
    read<{ engagement_id: string }>("uploaded_files", (q) =>
      q.select("engagement_id").limit(CAP),
    ),
    read<{ firm_id: string; amount_cents: number | null; status: string | null }>(
      "payment_requests",
      (q) => q.select("firm_id, amount_cents, status").limit(CAP),
    ),
    read<{ firm_id: string }>("client_messages", (q) => q.select("firm_id").limit(CAP)),
    read<{ firm_id: string; duration_minutes: number | null }>("time_entries", (q) =>
      q.select("firm_id, duration_minutes").is("deleted_at", null).limit(CAP),
    ),
    read<{ firm_id: string }>("automations", (q) => q.select("firm_id").limit(CAP)),
    read<{ firm_id: string }>("firm_services", (q) => q.select("firm_id").limit(CAP)),
    read<{ firm_id: string }>("templates", (q) => q.select("firm_id").limit(CAP)),
    read<{ firm_id: string }>("quickbooks_connections", (q) => q.select("firm_id").limit(CAP)),
    read<{ firm_id: string }>("xero_connections", (q) => q.select("firm_id").limit(CAP)),
    read<{ firm_id: string }>("storage_connections", (q) => q.select("firm_id").limit(CAP)),
    read<{ firm_id: string }>("calendar_connections", (q) => q.select("firm_id").limit(CAP)),
    read<{ firm_id: string; used: number | null }>("ai_usage_monthly", (q) =>
      q.select("firm_id, used").gte("period_month", monthStart).limit(CAP),
    ),
    // The pulse window: enough to answer "who is alive" without dragging the
    // whole history across the wire.
    read<{ firm_id: string; created_at: string; action: string }>("activity_log", (q) =>
      q.select("firm_id, created_at, action").gte("created_at", since).limit(CAP),
    ),
    // The feed itself — richer columns, hard limit, newest first.
    read<{
      id: string;
      firm_id: string;
      engagement_id: string | null;
      actor_type: string | null;
      actor_id: string | null;
      action: string;
      metadata: Record<string, unknown> | null;
      created_at: string;
    }>("activity_log", (q) =>
      q
        .select("id, firm_id, engagement_id, actor_type, actor_id, action, metadata, created_at")
        .order("created_at", { ascending: false })
        .limit(FEED_LIMIT),
    ),
    read<{
      id: string;
      contact_name: string | null;
      email: string;
      firm_name: string | null;
      firm_size: string | null;
      client_volume: string | null;
      current_tool: string | null;
      province: string | null;
      preferred_language: string | null;
      marketing_opt_in: boolean | null;
      furthest_step: number | null;
      booked_at: string | null;
      created_at: string;
    }>("demo_requests", (q) =>
      q
        .select(
          "id, contact_name, email, firm_name, firm_size, client_volume, current_tool, province, preferred_language, marketing_opt_in, furthest_step, booked_at, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(CAP),
    ),
    read<{ id: string; kind: string; status: string; attempts: number; last_error: string | null; created_at: string }>(
      "jobs",
      (q) => q.select("id, kind, status, attempts, last_error, created_at").limit(CAP),
    ),
  ]);

  // Signups over a year need their own read: the firms read above is already
  // everything (firms are few), so reuse it rather than asking twice.
  const signupTimestamps = firms.rows
    .map((f) => f.created_at)
    .filter((t) => t >= signupSince);

  // uploaded_files → firm, through the engagement it belongs to.
  const engagementFirm = new Map(engagements.rows.map((e) => [e.id, e.firm_id]));
  const uploadDocs = uploads.rows
    .map((u) => engagementFirm.get(u.engagement_id))
    .filter((id): id is string => Boolean(id))
    .map((firm_id) => ({ firm_id }));

  const sources: FirmSources = {
    firms: firms.rows,
    users: users.rows,
    clients: clients.rows,
    engagements: engagements.rows,
    tasks: tasks.rows,
    documents: [...imported.rows, ...finals.rows, ...uploadDocs],
    invoices: invoices.rows,
    messages: messages.rows,
    timeEntries: timeEntries.rows,
    automations: automations.rows,
    services: services.rows,
    templates: templates.rows,
    integrations: {
      quickbooks: qbo.rows,
      xero: xero.rows,
      storage: storage.rows,
      calendar: calendar.rows,
    },
    aiUsage: aiUsage.rows,
    events: events.rows,
  };

  const firmRows = buildFirmRows(sources, nowMs);
  const firmName = new Map(firmRows.map((f) => [f.id, f.name]));
  const userName = new Map(
    users.rows.map((u) => [u.id, (u.display_name?.trim() || u.name?.trim() || u.email) ?? u.email]),
  );

  const feed: FeedEvent[] = feedRows.rows.map((r) => ({
    id: r.id,
    firmId: r.firm_id,
    firmName: firmName.get(r.firm_id) ?? "(deleted firm)",
    engagementId: r.engagement_id,
    actorType: actorLabel(r.actor_type),
    // actor_id is plain TEXT — it may be a user id, a client id, or free text.
    // Resolve it when it happens to be one of ours; otherwise show nothing
    // rather than a raw uuid, which tells a reader nothing.
    actorName: r.actor_id ? (userName.get(r.actor_id) ?? null) : null,
    action: r.action,
    metadata: (r.metadata ?? {}) as Record<string, unknown>,
    createdAt: r.created_at,
  }));

  const totals = computeTotals(firmRows, events.rows, leads.rows, nowMs);
  const adoption = computeAdoption(firmRows);
  const health = computeHealth(jobs.rows, firmRows);

  // A lead has CONVERTED when a Vylan user exists with that email. Matching on
  // email is the only join available (demo_requests deliberately has no FK to
  // firms — the form is public and unauthenticated), so it is approximate in
  // one direction: someone who signs up with a different address reads as
  // un-converted. Better to under-claim conversions than over-claim them.
  const userEmails = new Set(users.rows.map((u) => u.email.trim().toLowerCase()));
  const leadRows: LeadRow[] = leads.rows.map((l) => ({
    id: l.id,
    contactName: l.contact_name,
    email: l.email,
    firmName: l.firm_name,
    firmSize: l.firm_size,
    clientVolume: l.client_volume,
    currentTool: l.current_tool,
    province: l.province,
    preferredLanguage: l.preferred_language,
    marketingOptIn: l.marketing_opt_in === true,
    furthestStep: l.furthest_step ?? 1,
    bookedAt: l.booked_at,
    createdAt: l.created_at,
    converted: userEmails.has(l.email.trim().toLowerCase()),
  }));

  const capped = collectCapped([
    ["firms", firms],
    ["users", users],
    ["clients", clients],
    ["engagements", engagements],
    ["engagement_tasks", tasks],
    ["imported_documents", imported],
    ["final_documents", finals],
    ["uploaded_files", uploads],
    ["payment_requests", invoices],
    ["client_messages", messages],
    ["time_entries", timeEntries],
    ["activity_log", events],
    ["demo_requests", leads],
    ["jobs", jobs],
  ]);

  return {
    totals,
    firms: firmRows,
    feed,
    signups: bucketByDay(signupTimestamps, 365, nowMs),
    activityByDay: bucketByDay(
      events.rows.map((e) => e.created_at),
      WINDOW_DAYS,
      nowMs,
    ),
    adoption,
    leads: leadRows,
    health,
    capped,
    windowDays: WINDOW_DAYS,
    generatedAt: new Date(nowMs).toISOString(),
  };
}

// ── derived roll-ups ─────────────────────────────────────────────────────────

function computeTotals(
  firms: readonly FirmRow[],
  events: ReadonlyArray<{ firm_id: string; created_at: string }>,
  leads: ReadonlyArray<{ booked_at: string | null }>,
  nowMs: number,
): PlatformTotals {
  const cut7 = sinceIso(nowMs, 7);
  const cut30 = sinceIso(nowMs, 30);
  const sum = (pick: (f: FirmRow) => number) => firms.reduce((a, f) => a + pick(f), 0);

  return {
    firms: firms.length,
    realFirms: firms.filter((f) => !f.isDemo).length,
    demoFirms: firms.filter((f) => f.isDemo).length,
    users: sum((f) => f.users),
    clients: sum((f) => f.clients),
    engagements: sum((f) => f.engagements),
    documents: sum((f) => f.documents),
    invoicedCents: sum((f) => f.invoicedCents),
    paidCents: sum((f) => f.paidCents),
    messages: sum((f) => f.messages),
    timeMinutes: sum((f) => f.timeMinutes),
    events30d: events.length,
    events7d: events.filter((e) => e.created_at >= cut7).length,
    activeFirms7d: firms.filter((f) => f.events7d > 0).length,
    activeFirms30d: firms.filter((f) => f.events30d > 0).length,
    newFirms30d: firms.filter((f) => f.createdAt >= cut30).length,
    leads: leads.length,
    leadsBooked: leads.filter((l) => l.booked_at).length,
  };
}

/** Feature adoption — how many firms have each thing switched on or used at
 *  least once. The denominator EXCLUDES demo firms: a seeded demo account has
 *  every feature by construction and would make every bar look healthy. */
function computeAdoption(firms: readonly FirmRow[]): AdoptionRow[] {
  const real = firms.filter((f) => !f.isDemo);
  const outOf = real.length;
  const has = (pick: (f: FirmRow) => boolean) => real.filter(pick).length;

  return [
    { key: "onboarded", firms: has((f) => Boolean(f.onboardedAt)), outOf },
    { key: "invited_team", firms: has((f) => f.users > 1), outOf },
    { key: "added_clients", firms: has((f) => f.clients > 0), outOf },
    { key: "created_engagement", firms: has((f) => f.engagements > 0), outOf },
    { key: "sent_engagement", firms: has((f) => f.activeEngagements + f.completedEngagements > 0), outOf },
    { key: "received_documents", firms: has((f) => f.documents > 0), outOf },
    { key: "used_tasks", firms: has((f) => f.tasks > 0), outOf },
    { key: "raised_invoice", firms: has((f) => f.invoices > 0), outOf },
    { key: "got_paid", firms: has((f) => f.paidCents > 0), outOf },
    { key: "messaged_client", firms: has((f) => f.messages > 0), outOf },
    { key: "tracked_time", firms: has((f) => f.timeMinutes > 0), outOf },
    { key: "built_services", firms: has((f) => f.services > 0), outOf },
    { key: "built_templates", firms: has((f) => f.templates > 0), outOf },
    { key: "workflows_on", firms: has((f) => f.workflowsEnabled), outOf },
    { key: "automations", firms: has((f) => f.automations > 0), outOf },
    { key: "bookkeeping", firms: has((f) => f.integrations.quickbooks || f.integrations.xero), outOf },
    { key: "cloud_storage", firms: has((f) => f.integrations.storage), outOf },
    { key: "calendar", firms: has((f) => f.integrations.calendar), outOf },
    { key: "used_ai", firms: has((f) => f.aiUsedThisMonth > 0), outOf },
  ];
}

function computeHealth(
  jobs: ReadonlyArray<{
    id: string;
    kind: string;
    status: string;
    attempts: number;
    last_error: string | null;
    created_at: string;
  }>,
  firms: readonly FirmRow[],
): HealthSnapshot {
  const byStatus = countBy(jobs, (j) => j.status);
  const failures = jobs
    .filter((j) => j.status === "failed")
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 12)
    .map((j) => ({
      id: j.id,
      kind: j.kind,
      attempts: j.attempts,
      lastError: j.last_error,
      createdAt: j.created_at,
    }));

  return {
    jobsPending: byStatus.pending ?? 0,
    jobsRunning: byStatus.running ?? 0,
    jobsFailed: byStatus.failed ?? 0,
    jobsDone: byStatus.done ?? 0,
    recentFailures: failures,
    aiUsedThisMonth: firms.reduce((a, f) => a + f.aiUsedThisMonth, 0),
    // 200 is half the 400/month default cap (migration 0230). A firm past it is
    // worth knowing about before they hit the ceiling and start seeing refusals.
    aiFirmsOverHalfCap: firms.filter((f) => f.aiUsedThisMonth >= 200).length,
  };
}

// ── the per-firm drill-down ──────────────────────────────────────────────────

export async function loadFirmDetail(
  firmId: string,
  nowMs: number = Date.now(),
): Promise<FirmDetail | null> {
  // The firm row itself comes from the same full load — one extra second on a
  // page nobody opens in a loop, in exchange for the detail page and the table
  // agreeing on every number by construction rather than by two code paths
  // happening to compute the same thing. That is the cohesion rule applied to
  // arithmetic: if the table said 12 engagements, this page must not say 11.
  const data = await loadFoundersData(nowMs);
  const firm = data.firms.find((f) => f.id === firmId);
  if (!firm) return null;

  const since = sinceIso(nowMs, WINDOW_DAYS);
  const [people, feedRows, windowEvents, engagements, clients] = await Promise.all([
    read<{ id: string; email: string; name: string | null; display_name: string | null; role: string | null; created_at: string; deactivated_at: string | null }>(
      "users",
      (q) =>
        q
          .select("id, email, name, display_name, role, created_at, deactivated_at")
          .eq("firm_id", firmId)
          .limit(CAP),
    ),
    read<{
      id: string;
      engagement_id: string | null;
      actor_type: string | null;
      actor_id: string | null;
      action: string;
      metadata: Record<string, unknown> | null;
      created_at: string;
    }>("activity_log", (q) =>
      q
        .select("id, engagement_id, actor_type, actor_id, action, metadata, created_at")
        .eq("firm_id", firmId)
        .order("created_at", { ascending: false })
        .limit(FEED_LIMIT),
    ),
    read<{ actor_id: string | null; action: string; created_at: string }>("activity_log", (q) =>
      q
        .select("actor_id, action, created_at")
        .eq("firm_id", firmId)
        .gte("created_at", since)
        .limit(CAP),
    ),
    read<{ id: string; title: string | null; status: string | null; client_id: string | null; created_at: string }>(
      "engagements",
      (q) =>
        q
          .select("id, title, status, client_id, created_at")
          .eq("firm_id", firmId)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(50),
    ),
    read<{ id: string; display_name: string | null }>("clients", (q) =>
      q.select("id, display_name").eq("firm_id", firmId).limit(CAP),
    ),
  ]);

  const nameOf = new Map(
    people.rows.map((u) => [u.id, (u.display_name?.trim() || u.name?.trim() || u.email) ?? u.email]),
  );
  const clientName = new Map(clients.rows.map((c) => [c.id, c.display_name ?? null]));

  const eventsByUser = countBy(windowEvents.rows, (e) => e.actor_id);
  const lastByUser = new Map<string, string>();
  for (const e of windowEvents.rows) {
    if (!e.actor_id) continue;
    const prev = lastByUser.get(e.actor_id);
    if (!prev || e.created_at > prev) lastByUser.set(e.actor_id, e.created_at);
  }

  const actionCounts = countBy(windowEvents.rows, (e) => e.action);
  const topActions = Object.entries(actionCounts)
    .map(([action, count]) => ({ action, count }))
    .sort((a, b) => b.count - a.count || a.action.localeCompare(b.action))
    .slice(0, 12);

  return {
    generatedAt: new Date(nowMs).toISOString(),
    firm,
    people: people.rows.map((u) => ({
      id: u.id,
      name: (u.display_name?.trim() || u.name?.trim() || u.email) ?? u.email,
      email: u.email,
      role: u.role ?? "staff",
      createdAt: u.created_at,
      deactivatedAt: u.deactivated_at,
      lastEventAt: lastByUser.get(u.id) ?? null,
      events30d: eventsByUser[u.id] ?? 0,
    })),
    feed: feedRows.rows.map((r) => ({
      id: r.id,
      firmId,
      firmName: firm.name,
      engagementId: r.engagement_id,
      actorType: actorLabel(r.actor_type),
      actorName: r.actor_id ? (nameOf.get(r.actor_id) ?? null) : null,
      action: r.action,
      metadata: (r.metadata ?? {}) as Record<string, unknown>,
      createdAt: r.created_at,
    })),
    activityByDay: bucketByDay(
      windowEvents.rows.map((e) => e.created_at),
      WINDOW_DAYS,
      nowMs,
    ),
    topActions,
    recentEngagements: engagements.rows.map((e) => ({
      id: e.id,
      title: e.title?.trim() || "(untitled)",
      status: e.status ?? "draft",
      clientName: e.client_id ? (clientName.get(e.client_id) ?? null) : null,
      createdAt: e.created_at,
    })),
  };
}

/** Re-exported so the feed components have one import for everything they need
 *  to render a row. */
export { activityCategory };
