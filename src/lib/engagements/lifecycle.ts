// Engagement lifecycle rules, kept as PURE predicates (no imports at all) so
// they're trivially unit-testable and shared by the DB query layer, the
// Overview worklist, and the All-Engagements sub-pages without drifting.
//
// Lifecycle is two independent, nullable timestamps layered on top of `status`:
//   - archived_at: hidden from active views, recoverable anytime, never purged.
//   - deleted_at:  soft-deleted; recoverable for DELETED_RETENTION_DAYS, then
//                  the daily cron permanently removes the row + its files.
// Delete takes precedence over archive: a soft-deleted engagement only ever
// shows in the Recently Deleted view, even if it was archived first.

// How long a soft-deleted engagement stays recoverable before the purge cron
// permanently removes it. Record-retention matters for accounting software:
// nothing is hard-deleted from the UI; everything passes through this window.
export const DELETED_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

// The lifecycle columns these predicates read (a structural subset of the
// Engagement row — any object with these fields, including a full Engagement,
// satisfies it).
type Lifecycle = { archived_at: string | null; deleted_at: string | null };

// Active = the day-to-day board: not archived, not deleted. Status (draft /
// sent / in_progress / complete / cancelled) is an orthogonal axis handled by
// the worklist selectors.
export function isActiveEngagement(e: Lifecycle): boolean {
  return e.deleted_at == null && e.archived_at == null;
}

// Archived = manually archived AND not (later) soft-deleted — delete wins.
export function isArchivedEngagement(e: Lifecycle): boolean {
  return e.deleted_at == null && e.archived_at != null;
}

// Recently Deleted = soft-deleted within the retention window. Anything older
// is awaiting (or mid-) purge and must not show in the UI.
export function isRecentlyDeletedEngagement(
  e: Pick<Lifecycle, "deleted_at">,
  nowMs: number,
  retentionDays: number = DELETED_RETENTION_DAYS,
): boolean {
  if (e.deleted_at == null) return false;
  const deletedMs = Date.parse(e.deleted_at);
  if (Number.isNaN(deletedMs)) return false;
  return deletedMs >= nowMs - retentionDays * DAY_MS;
}

// Purgeable = soft-deleted longer ago than the retention window. The cron's SQL
// filter (deleted_at < cutoff) mirrors this; kept here so the boundary is unit-
// tested in one place. Complementary to isRecentlyDeletedEngagement: a deleted
// engagement is either recently-deleted (shown) or purgeable (removed), never
// both — the boundary day (exactly retentionDays old) counts as recent.
export function isPurgeableEngagement(
  e: Pick<Lifecycle, "deleted_at">,
  nowMs: number,
  retentionDays: number = DELETED_RETENTION_DAYS,
): boolean {
  if (e.deleted_at == null) return false;
  const deletedMs = Date.parse(e.deleted_at);
  if (Number.isNaN(deletedMs)) return false;
  return deletedMs < nowMs - retentionDays * DAY_MS;
}

// Whole days remaining before a soft-deleted engagement is purged (for the
// "Deleted in N days" countdown). Clamped to >= 0; rounds up so a row deleted
// 23.2 days ago shows "7 days", not "6".
export function daysUntilPurge(
  deletedAt: string,
  nowMs: number,
  retentionDays: number = DELETED_RETENTION_DAYS,
): number {
  const deletedMs = Date.parse(deletedAt);
  if (Number.isNaN(deletedMs)) return 0;
  const purgeMs = deletedMs + retentionDays * DAY_MS;
  return Math.max(0, Math.ceil((purgeMs - nowMs) / DAY_MS));
}

// Soft-delete + restore are OWNER-ONLY. Archive is allowed for everyone (owner
// and staff). Enforced in the server actions; the UI also hides the Delete item
// from staff (defence in depth, not the only gate).
export function canDeleteEngagements(role: "owner" | "staff"): boolean {
  return role === "owner";
}

export function canArchiveEngagements(): boolean {
  return true;
}

// Lifecycle state of an engagement row, deciding its action menu's options.
// Derived from archived_at / deleted_at (delete wins over archive).
export type EngagementLifecycleState = "active" | "archived" | "deleted";

// Which actions an engagement row's menu shows, in order, for a given state and
// delete permission. Pure so it's unit-tested directly; the row menu
// (engagement-row-menu.tsx) maps these keys to handlers + icons.
//   active   → Open, Archive, [Delete]
//   archived → Open, Unarchive, [Delete]
//   deleted  → Open, [Restore]
// Delete / Restore appear only for owners (canDelete); Archive / Unarchive are
// available to everyone.
export function rowMenuItemKeys(
  state: EngagementLifecycleState,
  canDelete: boolean,
): ("open" | "archive" | "unarchive" | "restore" | "delete")[] {
  if (state === "deleted") return canDelete ? ["open", "restore"] : ["open"];
  if (state === "archived")
    return canDelete ? ["open", "unarchive", "delete"] : ["open", "unarchive"];
  return canDelete ? ["open", "archive", "delete"] : ["open", "archive"];
}
