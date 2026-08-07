// PURE arithmetic for the founders console — no Supabase, no clock, no imports
// from anything that touches the network.
//
// WHY THE SPLIT: the loader (load.ts) fans out ~20 cross-firm reads and then
// hands the raw arrays here to be turned into rows. Everything interesting —
// which firm a row belongs to, what "active in the last 7 days" means, how a
// day bucket is built across a month boundary — lives in this file, where it
// can be tested without a database.
//
// Every function takes `nowMs` explicitly rather than reading the clock, for
// the same reason the rest of this codebase does: a render that calls
// Date.now() is not pure, and a test that cannot pin the day is a test that
// passes in August and fails in January.

import type { DayBucket, FirmRow, IntegrationKey } from "@/lib/founders/types";

// ── small helpers ────────────────────────────────────────────────────────────

/** Count rows per key. Rows with a null/undefined key are skipped. */
export function countBy<T>(
  rows: readonly T[],
  key: (row: T) => string | null | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const k = key(row);
    if (!k) continue;
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/** Sum a numeric field per key. Non-finite values count as 0, never NaN. */
export function sumBy<T>(
  rows: readonly T[],
  key: (row: T) => string | null | undefined,
  value: (row: T) => number,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const k = key(row);
    if (!k) continue;
    const v = value(row);
    out[k] = (out[k] ?? 0) + (Number.isFinite(v) ? v : 0);
  }
  return out;
}

/** The latest timestamp per key, as an ISO string. */
export function maxBy<T>(
  rows: readonly T[],
  key: (row: T) => string | null | undefined,
  at: (row: T) => string | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) {
    const k = key(row);
    const t = at(row);
    if (!k || !t) continue;
    const current = out[k];
    if (!current || t > current) out[k] = t;
  }
  return out;
}

/** UTC calendar day of an instant, as YYYY-MM-DD. */
export function dayKey(iso: string | number | Date): string {
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

/** The instant `days` before `nowMs`, as an ISO string — the read cut-off. */
export function sinceIso(nowMs: number, days: number): string {
  return new Date(nowMs - days * 86_400_000).toISOString();
}

/**
 * A dense daily series ending TODAY (UTC) and running back `days` buckets.
 *
 * Dense on purpose: a sparse series drawn as a bar chart lies about time —
 * three signups on three consecutive Mondays and three signups on three
 * consecutive days look identical if the empty days are missing.
 *
 * UTC rather than the firm's timezone, deliberately. This is an internal
 * platform view spanning every firm at once (Vancouver to Halifax), so there is
 * no single local day to use; picking one firm's would make the others' counts
 * land on the wrong bar. Stated here because "why is UTC ok here when the
 * agenda card fought so hard for local midnight" is a fair question — the
 * agenda card is one person's day, this is the platform's.
 */
export function bucketByDay(
  timestamps: readonly (string | null | undefined)[],
  days: number,
  nowMs: number,
): DayBucket[] {
  const counts: Record<string, number> = {};
  for (const t of timestamps) {
    if (!t) continue;
    const k = dayKey(t);
    if (k) counts[k] = (counts[k] ?? 0) + 1;
  }
  const out: DayBucket[] = [];
  // Anchor on UTC midnight so adding whole days can never drift by an hour
  // across a DST change in whatever timezone the server happens to run in.
  const todayUtc = Date.parse(`${dayKey(nowMs)}T00:00:00.000Z`);
  for (let i = days - 1; i >= 0; i--) {
    const date = dayKey(todayUtc - i * 86_400_000);
    out.push({ date, count: counts[date] ?? 0 });
  }
  return out;
}

/** Accent- and case-insensitive folding, the same three lines the rest of the
 *  app uses (doc-type-picker, conversation-search). Re-declared rather than
 *  imported because both of those live in "use client" modules, and a value
 *  imported from one of those into a server module is a stub, not a function. */
export function foldForSearch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Token-based match, so "zt asso" finds "ZT & Associates". Empty query
 *  matches everything. */
export function matchesQuery(haystack: string, query: string): boolean {
  const tokens = foldForSearch(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const hay = foldForSearch(haystack);
  return tokens.every((t) => hay.includes(t));
}

// ── the firm table ───────────────────────────────────────────────────────────

/** The raw, already-fetched arrays the assembler folds into rows. Every field
 *  is a plain array of the minimum columns needed — see load.ts. */
export type FirmSources = {
  firms: Array<{
    id: string;
    name: string | null;
    plan: string | null;
    is_demo: boolean | null;
    is_pilot: boolean | null;
    locale_default: string | null;
    province: string | null;
    created_at: string;
    onboarded_at: string | null;
    trial_ends_at: string | null;
    subscription_status: string | null;
    workflows_enabled: boolean | null;
    time_insights_enabled: boolean | null;
  }>;
  users: Array<{ firm_id: string; role: string | null; deactivated_at: string | null }>;
  clients: Array<{ firm_id: string; archived_at: string | null }>;
  engagements: Array<{ firm_id: string; status: string | null; deleted_at?: string | null }>;
  tasks: Array<{ firm_id: string; status: string | null }>;
  documents: Array<{ firm_id: string }>;
  invoices: Array<{ firm_id: string; amount_cents: number | null; status: string | null }>;
  messages: Array<{ firm_id: string }>;
  /** Only the USER turns of the in-app assistant — counting the assistant's own
   *  replies would double every conversation and make a firm that asked one
   *  question look like two. */
  assistantMessages: Array<{ firm_id: string }>;
  signatures: Array<{ firm_id: string }>;
  timeEntries: Array<{ firm_id: string; duration_minutes: number | null }>;
  automations: Array<{ firm_id: string }>;
  services: Array<{ firm_id: string }>;
  templates: Array<{ firm_id: string }>;
  integrations: Record<IntegrationKey, Array<{ firm_id: string }>>;
  aiUsage: Array<{ firm_id: string; used: number | null }>;
  /** Every activity row inside the window — used for the pulse columns. */
  events: Array<{ firm_id: string; created_at: string; actor_type?: string | null }>;
  /** The founders' watchlist (migration 1810). Empty while unapplied. */
  pinnedFirmIds?: readonly string[];
};

/**
 * Fold the raw arrays into one row per firm.
 *
 * Counting happens in JS rather than in SQL on purpose, and it is worth saying
 * why so nobody "optimises" it into twenty RPCs: Vylan's whole platform is in
 * the low hundreds of rows per table today. Twenty grouped reads with a hard
 * row ceiling is one round trip each and a few hundred kilobytes total, and it
 * keeps every rule in this file testable. If a table ever genuinely outgrows
 * the ceiling, load.ts reports it as a capped read (visible in the UI) — which
 * is the signal to move THAT table's count into SQL, not all of them.
 */
export function buildFirmRows(sources: FirmSources, nowMs: number): FirmRow[] {
  const usersByFirm = countBy(sources.users, (u) => u.firm_id);
  const activeUsers = countBy(
    sources.users.filter((u) => !u.deactivated_at),
    (u) => u.firm_id,
  );
  const owners = countBy(
    sources.users.filter((u) => u.role === "owner"),
    (u) => u.firm_id,
  );
  const clients = countBy(sources.clients, (c) => c.firm_id);
  const activeClients = countBy(
    sources.clients.filter((c) => !c.archived_at),
    (c) => c.firm_id,
  );

  const liveEngagements = sources.engagements.filter((e) => !e.deleted_at);
  const engagements = countBy(liveEngagements, (e) => e.firm_id);
  const activeEngagements = countBy(
    liveEngagements.filter((e) => e.status === "sent" || e.status === "in_progress"),
    (e) => e.firm_id,
  );
  const completedEngagements = countBy(
    liveEngagements.filter((e) => e.status === "complete"),
    (e) => e.firm_id,
  );
  const draftEngagements = countBy(
    liveEngagements.filter((e) => e.status === "draft"),
    (e) => e.firm_id,
  );

  const tasks = countBy(sources.tasks, (t) => t.firm_id);
  const openTasks = countBy(
    sources.tasks.filter((t) => t.status !== "done"),
    (t) => t.firm_id,
  );
  const documents = countBy(sources.documents, (d) => d.firm_id);

  const invoices = countBy(sources.invoices, (i) => i.firm_id);
  const invoicedCents = sumBy(
    sources.invoices,
    (i) => i.firm_id,
    (i) => i.amount_cents ?? 0,
  );
  const paidCents = sumBy(
    sources.invoices.filter((i) => i.status === "paid"),
    (i) => i.firm_id,
    (i) => i.amount_cents ?? 0,
  );

  const messages = countBy(sources.messages, (m) => m.firm_id);
  const assistantMessages = countBy(sources.assistantMessages, (m) => m.firm_id);
  const signatures = countBy(sources.signatures, (s) => s.firm_id);
  const timeMinutes = sumBy(
    sources.timeEntries,
    (t) => t.firm_id,
    (t) => t.duration_minutes ?? 0,
  );
  const automations = countBy(sources.automations, (a) => a.firm_id);
  const services = countBy(sources.services, (s) => s.firm_id);
  const templates = countBy(sources.templates, (t) => t.firm_id);
  const aiUsed = sumBy(
    sources.aiUsage,
    (a) => a.firm_id,
    (a) => a.used ?? 0,
  );

  const integrationSets = {
    quickbooks: new Set(sources.integrations.quickbooks.map((r) => r.firm_id)),
    xero: new Set(sources.integrations.xero.map((r) => r.firm_id)),
    storage: new Set(sources.integrations.storage.map((r) => r.firm_id)),
    calendar: new Set(sources.integrations.calendar.map((r) => r.firm_id)),
  };

  const cut7 = sinceIso(nowMs, 7);
  const events30 = countBy(sources.events, (e) => e.firm_id);
  const events7 = countBy(
    sources.events.filter((e) => e.created_at >= cut7),
    (e) => e.firm_id,
  );
  const pinned = new Set(sources.pinnedFirmIds ?? []);
  const clientEvents = countBy(
    sources.events.filter((e) => e.actor_type === "client"),
    (e) => e.firm_id,
  );
  const lastEvent = maxBy(
    sources.events,
    (e) => e.firm_id,
    (e) => e.created_at,
  );

  return sources.firms.map((f) => ({
    id: f.id,
    // A firm with no name is a broken row, not an empty string to render as a
    // gap you cannot click.
    name: f.name?.trim() || "(unnamed firm)",
    plan: f.plan ?? "trial",
    isDemo: f.is_demo === true,
    isPilot: f.is_pilot === true,
    locale: f.locale_default ?? "fr",
    province: f.province ?? null,
    createdAt: f.created_at,
    onboardedAt: f.onboarded_at ?? null,
    trialEndsAt: f.trial_ends_at ?? null,
    subscriptionStatus: f.subscription_status ?? null,

    users: usersByFirm[f.id] ?? 0,
    activeUsers: activeUsers[f.id] ?? 0,
    owners: owners[f.id] ?? 0,

    clients: clients[f.id] ?? 0,
    activeClients: activeClients[f.id] ?? 0,

    engagements: engagements[f.id] ?? 0,
    activeEngagements: activeEngagements[f.id] ?? 0,
    completedEngagements: completedEngagements[f.id] ?? 0,
    draftEngagements: draftEngagements[f.id] ?? 0,
    tasks: tasks[f.id] ?? 0,
    openTasks: openTasks[f.id] ?? 0,

    documents: documents[f.id] ?? 0,

    invoices: invoices[f.id] ?? 0,
    invoicedCents: invoicedCents[f.id] ?? 0,
    paidCents: paidCents[f.id] ?? 0,

    messages: messages[f.id] ?? 0,
    assistantMessages: assistantMessages[f.id] ?? 0,
    signatures: signatures[f.id] ?? 0,
    timeMinutes: timeMinutes[f.id] ?? 0,

    integrations: {
      quickbooks: integrationSets.quickbooks.has(f.id),
      xero: integrationSets.xero.has(f.id),
      storage: integrationSets.storage.has(f.id),
      calendar: integrationSets.calendar.has(f.id),
    },
    automations: automations[f.id] ?? 0,
    services: services[f.id] ?? 0,
    templates: templates[f.id] ?? 0,
    workflowsEnabled: f.workflows_enabled === true,
    timeInsightsEnabled: f.time_insights_enabled === true,

    events7d: events7[f.id] ?? 0,
    events30d: events30[f.id] ?? 0,
    clientEvents30d: clientEvents[f.id] ?? 0,
    lastActivityAt: lastEvent[f.id] ?? null,
    aiUsedThisMonth: aiUsed[f.id] ?? 0,
    pinned: pinned.has(f.id),
  }));
}

// ── sorting ──────────────────────────────────────────────────────────────────

export type FirmSortKey =
  | "name"
  | "createdAt"
  | "users"
  | "clients"
  | "engagements"
  | "documents"
  | "invoicedCents"
  | "paidCents"
  | "timeMinutes"
  | "events30d"
  | "lastActivityAt";

export const FIRM_SORT_KEYS: readonly FirmSortKey[] = [
  "name",
  "createdAt",
  "users",
  "clients",
  "engagements",
  "documents",
  "invoicedCents",
  "paidCents",
  "timeMinutes",
  "events30d",
  "lastActivityAt",
] as const;

export function isFirmSortKey(v: unknown): v is FirmSortKey {
  return typeof v === "string" && (FIRM_SORT_KEYS as readonly string[]).includes(v);
}

/**
 * Sort a copy — never in place. A firm that has never done anything sorts LAST
 * on "last activity" in either direction: `null` is not "the beginning of
 * time", it is "no answer", and putting silent firms at the top of a descending
 * activity sort would bury the ones you actually want to look at.
 *
 * PINNED FIRMS FLOAT TO THE TOP OF EVERY SORT, in every direction. That is the
 * point of pinning: "the firms we're tracking" have to be where you left them
 * whichever column you happen to be looking at, or the pin is just decoration.
 * They are sorted among THEMSELVES by the chosen column, so the feature adds a
 * grouping and never takes the sort away. Pass `pinnedFirst: false` for a
 * genuinely flat ordering.
 */
export function sortFirmRows(
  rows: readonly FirmRow[],
  key: FirmSortKey,
  dir: "asc" | "desc",
  pinnedFirst = true,
): FirmRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (pinnedFirst && a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (key === "name") return sign * a.name.localeCompare(b.name);
    if (key === "createdAt") return sign * a.createdAt.localeCompare(b.createdAt);
    if (key === "lastActivityAt") {
      if (!a.lastActivityAt && !b.lastActivityAt) return a.name.localeCompare(b.name);
      if (!a.lastActivityAt) return 1;
      if (!b.lastActivityAt) return -1;
      return sign * a.lastActivityAt.localeCompare(b.lastActivityAt);
    }
    const av = a[key];
    const bv = b[key];
    const delta = (typeof av === "number" ? av : 0) - (typeof bv === "number" ? bv : 0);
    // Ties fall back to the name so the order is stable between renders rather
    // than depending on whatever order Postgres happened to return.
    return delta === 0 ? a.name.localeCompare(b.name) : sign * delta;
  });
}

/** Free-text filter over the fields a founder would actually type. */
export function filterFirmRows(rows: readonly FirmRow[], query: string): FirmRow[] {
  if (!query.trim()) return [...rows];
  return rows.filter((r) =>
    matchesQuery([r.name, r.plan, r.province ?? "", r.id].join(" "), query),
  );
}

// ── formatting ───────────────────────────────────────────────────────────────

/** Cents → "$1,250.00". Integer cents in, never a float. */
export function formatCents(cents: number, locale = "en-CA"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(Math.round(cents) / 100);
}

/** Minutes → "12h 30m" / "45m" / "—". */
export function formatMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "—";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** "3d ago" / "2h ago" / "just now" / "—". Coarse on purpose: this is a scan
 *  column, and the exact instant is one hover away in the title attribute. */
export function relativeAge(iso: string | null, nowMs: number): string {
  if (!iso) return "—";
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "—";
  const secs = Math.max(0, Math.round((nowMs - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}
