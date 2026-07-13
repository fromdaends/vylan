// Create a QuickBooks name-list entity (Vendor / Customer) inline from the
// draft-card picker's "+ Create '<name>'" affordance, then cache it so it's
// immediately postable + visible. Kept separate from the route so it's unit-
// testable (the route just does auth + parsing + context).

import {
  quickbooksCreateNameEntity,
  quickbooksFindNameEntityByName,
  isDuplicateNameError,
  type QboNameKind,
} from "@/lib/quickbooks/client";
import { upsertCachedEntityRow } from "@/lib/db/quickbooks-cache";
import type { QuickbooksReadContext } from "@/lib/quickbooks/connection";

// QuickBooks DisplayName is capped at 100 chars and can't contain a colon (it's
// the name-hierarchy separator). Trim + validate so we never round-trip to Intuit
// with input it will only reject.
export const QBO_DISPLAY_NAME_MAX = 100;

export function normalizeEntityName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  if (name.length === 0 || name.length > QBO_DISPLAY_NAME_MAX) return null;
  if (name.includes(":")) return null;
  return name;
}

export type CreateEntityResult =
  | { ok: true; entity: { id: string; name: string } }
  | { ok: false; reason: "duplicate" | "failed"; detail: string };

// Create the entity; if QuickBooks says the name already exists (6240) but our
// cache hadn't caught it, look up the real id and use that (create-or-find, so the
// affordance is idempotent). Always caches the result under the current firm so
// the draft can post (checkBillPostable requires an ACTIVE cached party) and the
// picker shows it after a refresh. `now` is injected so the caller/tests control
// the cache timestamp.
export async function createOrFindNameEntity(input: {
  firmId: string;
  kind: QboNameKind;
  name: string;
  ctx: QuickbooksReadContext;
  now: string;
}): Promise<CreateEntityResult> {
  const { firmId, kind, name, ctx, now } = input;
  let entity: { id: string; name: string };
  try {
    entity = await quickbooksCreateNameEntity(ctx, kind, name);
  } catch (e) {
    if (isDuplicateNameError(e)) {
      const existing = await quickbooksFindNameEntityByName(ctx, kind, name);
      if (!existing) {
        return {
          ok: false,
          reason: "duplicate",
          detail: "That name already exists in QuickBooks.",
        };
      }
      entity = existing;
    } else {
      return {
        ok: false,
        reason: "failed",
        detail: e instanceof Error ? e.message : "QuickBooks create failed.",
      };
    }
  }
  // Cache it (active) so the draft is immediately postable + it shows in the
  // picker. Best-effort inside upsertCachedEntityRow: a missing cache table is a
  // no-op, and the pick still works because it's recorded on the draft by id.
  await upsertCachedEntityRow(
    firmId,
    kind === "vendor" ? "vendors" : "customers",
    { id: entity.id, name: entity.name, active: true },
    now,
  );
  return { ok: true, entity };
}
