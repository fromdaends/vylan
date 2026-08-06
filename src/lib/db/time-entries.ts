// Time entries — reading and writing time_entries (migration 1750).
//
// AN HOUR IS NOT A DOLLAR. This module reads and writes the HOURS side only:
// there is no join to time_entry_costs, no rate field on any type it exports,
// and nothing here may grow one. The cost side lives behind its own RLS
// (capability-gated) and is read exclusively by the Phase 2 insights module —
// keeping the two in separate modules is what makes "staff can never receive a
// rate through the entries path" checkable by reading ONE file's imports.
//
// Every read and write here runs as the CALLER (RLS decides):
//   read    — the whole firm's entries, minus private clients for those
//             without the capability. Shared hours are the founder's ruling:
//             a capacity view everybody can see.
//   insert  — your own entries only (user_id = auth.uid() in the policy).
//   update / delete — your own, or anybody's with time.manage.
//
// READS DEGRADE, WRITES REFUSE, the engagement-tasks shape: before 1750 there
// is no table — a read answers "no time yet", a write names the migration.

import { getServerSupabase } from "@/lib/supabase/server";
import { isMissingSchema } from "@/lib/db/quickbooks";

export type TimeEntry = {
  id: string;
  firm_id: string;
  user_id: string;
  client_id: string;
  engagement_id: string | null;
  task_id: string | null;
  started_at: string;
  /** Null = this timer is RUNNING. */
  ended_at: string | null;
  duration_minutes: number;
  note: string | null;
  is_manual: boolean;
  created_at: string;
};

/** A running or finished entry with the names the pill and the lists print.
 *  Names come from RLS-scoped joins, so a name the caller may not see is
 *  simply null. */
export type TimeEntryWithNames = TimeEntry & {
  client_name: string | null;
  engagement_title: string | null;
};

export class TimeEntriesUnsupportedError extends Error {
  constructor() {
    super("time_entries is not available — apply supabase/migrations/1750");
    this.name = "TimeEntriesUnsupportedError";
  }
}

const SELECT =
  "id, firm_id, user_id, client_id, engagement_id, task_id, started_at, ended_at, duration_minutes, note, is_manual, created_at";

type JoinedRow = TimeEntry & {
  clients: { display_name: string } | null;
  engagements: { title: string } | null;
};

function withNames(row: JoinedRow): TimeEntryWithNames {
  const { clients, engagements, ...entry } = row;
  return {
    ...entry,
    client_name: clients?.display_name ?? null,
    engagement_title: engagements?.title ?? null,
  };
}

/** The caller's OWN running timer, if any — the pill's one question. The
 *  partial unique index guarantees at most one row. */
export async function getRunningEntry(
  userId: string,
): Promise<TimeEntryWithNames | null> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("time_entries")
    .select(`${SELECT}, clients(display_name), engagements(title)`)
    .eq("user_id", userId)
    .is("ended_at", null)
    .is("deleted_at", null)
    .maybeSingle();
  if (error || !data) {
    if (error && !isMissingSchema(error)) {
      console.error("[time-entries] running lookup failed:", error);
    }
    return null;
  }
  return withNames(data as unknown as JoinedRow);
}

/** Every entry on one engagement, newest first — the engagement's Time list. */
export async function listEntriesForEngagement(
  engagementId: string,
): Promise<TimeEntryWithNames[]> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("time_entries")
    .select(`${SELECT}, clients(display_name), engagements(title)`)
    .eq("engagement_id", engagementId)
    .is("deleted_at", null)
    .not("ended_at", "is", null)
    .order("started_at", { ascending: false })
    .limit(500);
  if (error) {
    if (!isMissingSchema(error)) {
      console.error("[time-entries] engagement list failed:", error);
    }
    return [];
  }
  return ((data ?? []) as unknown as JoinedRow[]).map(withNames);
}

/** Recent entries for one client — the client profile's Time panel. */
export async function listEntriesForClient(
  clientId: string,
  limit = 50,
): Promise<TimeEntryWithNames[]> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("time_entries")
    .select(`${SELECT}, clients(display_name), engagements(title)`)
    .eq("client_id", clientId)
    .is("deleted_at", null)
    .not("ended_at", "is", null)
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) {
    if (!isMissingSchema(error)) {
      console.error("[time-entries] client list failed:", error);
    }
    return [];
  }
  return ((data ?? []) as unknown as JoinedRow[]).map(withNames);
}

/** Every FINISHED entry in the firm since `startIso` (null = all time) — the
 *  Insights aggregation read. Slim columns on purpose: no note (nothing in
 *  Insights renders one) and, as everywhere in this module, no dollar field.
 *  Paginated because "all time" on a busy firm outgrows one page; capped far
 *  above any real firm so a runaway can't loop forever. */
export async function listEntriesForInsights(
  startIso: string | null,
): Promise<
  {
    id: string;
    user_id: string;
    client_id: string;
    engagement_id: string | null;
    started_at: string;
    duration_minutes: number;
  }[]
> {
  const supabase = await getServerSupabase();
  const PAGE = 1000;
  const MAX_ROWS = 50_000;
  type Row = {
    id: string;
    user_id: string;
    client_id: string;
    engagement_id: string | null;
    started_at: string;
    duration_minutes: number;
  };
  // ASCENDING + dedupe-by-id: offset pagination over a DESC sort shifts every
  // page when a teammate saves an entry mid-load, double-counting rows. Oldest
  // first, new inserts land past the end — worst case the very newest entry is
  // missed for one render, never counted twice. The map is the belt to that
  // suspender.
  const byId = new Map<string, Row>();
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    let q = supabase
      .from("time_entries")
      .select("id, user_id, client_id, engagement_id, started_at, duration_minutes")
      .is("deleted_at", null)
      .not("ended_at", "is", null)
      .order("started_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (startIso) q = q.gte("started_at", startIso);
    const { data, error } = await q;
    if (error) {
      if (!isMissingSchema(error)) {
        console.error("[time-entries] insights list failed:", error);
      }
      return [...byId.values()];
    }
    const rows = (data ?? []) as Row[];
    for (const r of rows) byId.set(r.id, r);
    if (rows.length < PAGE) break;
  }
  return [...byId.values()];
}

/** Start a timer for the caller. The action layer stops any running timer
 *  first; the DB's partial unique index is the backstop the action cannot
 *  race. 23505 from that index surfaces as `conflict` so the action can stop
 *  the straggler and retry once. */
export async function insertTimerStart(input: {
  firmId: string;
  userId: string;
  clientId: string;
  engagementId: string | null;
  taskId: string | null;
}): Promise<{ entry: TimeEntry | null; conflict: boolean }> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("time_entries")
    .insert({
      firm_id: input.firmId,
      user_id: input.userId,
      client_id: input.clientId,
      engagement_id: input.engagementId,
      task_id: input.taskId,
      started_at: new Date().toISOString(),
      is_manual: false,
      duration_minutes: 0,
    })
    .select(SELECT)
    .single();
  if (error) {
    if (error.code === "23505") return { entry: null, conflict: true };
    if (isMissingSchema(error)) throw new TimeEntriesUnsupportedError();
    throw error;
  }
  return { entry: data as unknown as TimeEntry, conflict: false };
}

/** Stop the caller's running entry: stamp the end, compute the minutes. Runs
 *  as the caller, so stopping somebody else's timer is refused by RLS unless
 *  they hold time.manage.
 *
 *  IDEMPOTENT: stopping an entry a second tab already stopped returns the
 *  FINISHED entry rather than an error — the hour is saved either way, and
 *  the loser of that race did nothing wrong. Null only when the entry is
 *  gone or not the caller's to see. */
export async function stopEntry(
  entryId: string,
  note?: string | null,
): Promise<TimeEntry | null> {
  const supabase = await getServerSupabase();
  // Read WITHOUT the running filter: duration is derived server-side from the
  // row, and an already-stopped row is the benign race, not a miss.
  const { data: row, error: readError } = await supabase
    .from("time_entries")
    .select(SELECT)
    .eq("id", entryId)
    .is("deleted_at", null)
    .maybeSingle();
  if (readError || !row) {
    if (readError && isMissingSchema(readError)) {
      throw new TimeEntriesUnsupportedError();
    }
    return null;
  }
  const current = row as unknown as TimeEntry;
  if (current.ended_at != null) return current;

  const startedAt = new Date(current.started_at);
  const endedAt = new Date();
  const minutes = Math.max(
    0,
    Math.round((endedAt.getTime() - startedAt.getTime()) / 60_000),
  );
  const patch: Record<string, unknown> = {
    ended_at: endedAt.toISOString(),
    duration_minutes: minutes,
  };
  if (note !== undefined) patch.note = note;
  const { data, error } = await supabase
    .from("time_entries")
    .update(patch)
    .eq("id", entryId)
    .is("ended_at", null)
    .select(SELECT)
    .maybeSingle();
  if (error) {
    if (isMissingSchema(error)) throw new TimeEntriesUnsupportedError();
    throw error;
  }
  if (data) return data as unknown as TimeEntry;
  // Lost the race between the read and the update — the other tab's stop won.
  // Re-read once and hand back what it saved.
  const { data: settled } = await supabase
    .from("time_entries")
    .select(SELECT)
    .eq("id", entryId)
    .is("deleted_at", null)
    .maybeSingle();
  return (settled as unknown as TimeEntry) ?? null;
}

/** A manual entry: a chosen day, a typed duration, ended_at set immediately —
 *  a manual entry is never "running", and leaving ended_at null would collide
 *  with the one-running-timer index. */
export async function insertManualEntry(input: {
  firmId: string;
  userId: string;
  clientId: string;
  engagementId: string | null;
  taskId: string | null;
  startedAt: Date;
  durationMinutes: number;
  note: string | null;
}): Promise<TimeEntry> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("time_entries")
    .insert({
      firm_id: input.firmId,
      user_id: input.userId,
      client_id: input.clientId,
      engagement_id: input.engagementId,
      task_id: input.taskId,
      started_at: input.startedAt.toISOString(),
      ended_at: new Date(
        input.startedAt.getTime() + input.durationMinutes * 60_000,
      ).toISOString(),
      duration_minutes: input.durationMinutes,
      note: input.note,
      is_manual: true,
    })
    .select(SELECT)
    .single();
  if (error) {
    if (isMissingSchema(error)) throw new TimeEntriesUnsupportedError();
    throw error;
  }
  return data as unknown as TimeEntry;
}

/** Edit a finished entry. RLS decides whose entries the caller may touch. */
export async function updateEntry(
  entryId: string,
  patch: {
    startedAt?: Date;
    durationMinutes?: number;
    note?: string | null;
    engagementId?: string | null;
  },
): Promise<TimeEntry | null> {
  const supabase = await getServerSupabase();
  const row: Record<string, unknown> = {};
  if (patch.startedAt !== undefined) {
    row.started_at = patch.startedAt.toISOString();
  }
  if (patch.durationMinutes !== undefined) {
    row.duration_minutes = patch.durationMinutes;
  }
  if (patch.note !== undefined) row.note = patch.note;
  if (patch.engagementId !== undefined) row.engagement_id = patch.engagementId;
  if (Object.keys(row).length === 0) return null;
  const { data, error } = await supabase
    .from("time_entries")
    .update(row)
    .eq("id", entryId)
    .is("deleted_at", null)
    .select(SELECT)
    .maybeSingle();
  if (error) {
    if (isMissingSchema(error)) throw new TimeEntriesUnsupportedError();
    throw error;
  }
  return (data as unknown as TimeEntry) ?? null;
}

/** Soft delete (0139 lifecycle). An UPDATE under RLS, so the same rule as
 *  editing: yours, or time.manage. */
export async function softDeleteEntry(
  entryId: string,
  deletedByUserId: string,
): Promise<boolean> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("time_entries")
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by_user_id: deletedByUserId,
    })
    .eq("id", entryId)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  if (error) {
    if (isMissingSchema(error)) throw new TimeEntriesUnsupportedError();
    throw error;
  }
  return data != null;
}
