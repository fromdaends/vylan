"use server";

// Naming the firm's task statuses.
//
// Owner-only via team.manage, for every write — and the gate is load bearing
// for the same reason it is on roles: a status list is the vocabulary the whole
// board speaks. One person renaming "Done" mid-season changes what every other
// person's screen means. Reading them is open to the firm, because every task
// row renders one.
//
// This file exports async functions ONLY: a "use server" module with a sync
// export typechecks, lints, passes every test, and then fails the production
// build naming something else entirely.

import { getCurrentUser } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import { can } from "@/lib/auth/capabilities";
import {
  createTaskStatus,
  updateTaskStatus,
  deleteTaskStatus,
  type StatusBucket,
} from "@/lib/db/task-statuses";
import { revalidateAllLocales } from "@/lib/revalidate";

export type StatusActionResult = {
  ok: boolean;
  error?:
    | "no_session"
    | "not_allowed"
    | "bad_name"
    | "duplicate"
    | "last_in_bucket"
    | "failed";
  /** The row that was just created, so the list can show it WITHOUT waiting for
   *  a refresh to bring it back. See the editor's note on why that matters:
   *  the whole page read as broken because every change was invisible until a
   *  manual reload. Only createStatusAction sets it. */
  created?: {
    id: string;
    name: string;
    color: string;
    bucket: StatusBucket;
  };
};

// Long enough for "Waiting on client signature", short enough to fit a pill in
// a table column without the column deciding the layout.
const NAME_MAX = 32;

function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().replace(/\s+/g, " ").slice(0, NAME_MAX);
  return name || null;
}

/** A hex the UI can render. Anything else falls back to the default slate
 *  rather than being written through — a colour is not worth an error. */
function cleanColor(raw: unknown): string {
  return typeof raw === "string" && /^#[0-9a-fA-F]{6}$/.test(raw.trim())
    ? raw.trim().toLowerCase()
    : "#64748b";
}

function cleanBucket(raw: unknown): StatusBucket {
  return raw === "doing" || raw === "done" ? raw : "todo";
}

async function guard() {
  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user || !firm) return { error: "no_session" as const };
  if (!can(user, "team.manage")) return { error: "not_allowed" as const };
  return { user, firm };
}

// Both places a status is read from. The settings page lists them; every task
// screen renders them on rows.
function revalidateStatuses() {
  revalidateAllLocales("/settings/statuses");
  revalidateAllLocales("/work");
  revalidateAllLocales("/engagements");
  revalidateAllLocales("/dashboard");
}

export async function createStatusAction(input: {
  name: string;
  color: string;
  bucket: string;
}): Promise<StatusActionResult> {
  const g = await guard();
  if ("error" in g) return { ok: false, error: g.error };
  const name = cleanName(input.name);
  if (!name) return { ok: false, error: "bad_name" };

  const color = cleanColor(input.color);
  const bucket = cleanBucket(input.bucket);
  const res = await createTaskStatus({
    firmId: g.firm.id,
    name,
    color,
    bucket,
    createdBy: g.user.id,
  });
  if ("error" in res) return { ok: false, error: res.error };
  revalidateStatuses();
  // Hand the row back so the editor can put it on screen immediately. The
  // CLEANED values, not the raw input — the list must show what was actually
  // stored, or the first reload would silently "change" what you just typed.
  return { ok: true, created: { id: res.id, name, color, bucket } };
}

export async function updateStatusAction(input: {
  id: string;
  name?: string;
  color?: string;
  bucket?: string;
}): Promise<StatusActionResult> {
  const g = await guard();
  if ("error" in g) return { ok: false, error: g.error };

  const patch: { name?: string; color?: string; bucket?: StatusBucket } = {};
  if (input.name !== undefined) {
    const name = cleanName(input.name);
    if (!name) return { ok: false, error: "bad_name" };
    patch.name = name;
  }
  if (input.color !== undefined) patch.color = cleanColor(input.color);
  // Moving a status to another bucket RECLASSIFIES every task on it — the
  // database trigger rewrites their enum from the new bucket. That is the
  // intended behaviour ("With client" turning out to mean done, not doing) and
  // it is why the UI says so before it lets you.
  if (input.bucket !== undefined) patch.bucket = cleanBucket(input.bucket);

  const res = await updateTaskStatus({
    id: input.id,
    firmId: g.firm.id,
    patch,
  });
  if ("error" in res) return { ok: false, error: res.error };
  revalidateStatuses();
  return { ok: true };
}

export async function deleteStatusAction(input: {
  id: string;
  /** Where its tasks go. Required — see the note in db/task-statuses.ts. */
  replacementId: string;
}): Promise<StatusActionResult> {
  const g = await guard();
  if ("error" in g) return { ok: false, error: g.error };

  const res = await deleteTaskStatus({
    id: input.id,
    replacementId: input.replacementId,
    firmId: g.firm.id,
  });
  if ("error" in res) return { ok: false, error: res.error };
  revalidateStatuses();
  return { ok: true };
}
