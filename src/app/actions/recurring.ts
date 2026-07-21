"use server";

// Server actions for recurring engagement series (Phase 1): the engagement
// page's Repeat dialog. The builder's create-with-repeat path reuses the same
// core (src/lib/recurring/enable.ts) from createEngagementAction.

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import { getEngagement } from "@/lib/db/engagements";
import { listRequestItems } from "@/lib/db/request-items";
import { endRecurringSeries, getRecurringSeries } from "@/lib/db/recurring";
import { applyRepeatChoice } from "@/lib/recurring/enable";
import { snapshotFromRequestItems } from "@/lib/recurring/snapshot";

// Same permissive uuid check as actions/engagements.ts (seed data isn't
// strictly RFC 4122).
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RepeatSchema = z.object({
  engagementId: z.string().regex(UUID_REGEX),
  frequency: z.enum(["off", "monthly", "quarterly", "yearly"]),
  dueOffsetDays: z.number().int().min(1).max(365),
});

export type RepeatEditResult =
  | { ok: true }
  | { ok: false; error: "invalid" | "not_found" | "no_documents" | "save_failed" };

export async function setEngagementRepeatAction(input: {
  engagementId: string;
  frequency: "off" | "monthly" | "quarterly" | "yearly";
  dueOffsetDays: number;
}): Promise<RepeatEditResult> {
  const parsed = RepeatSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const [user, firm, engagement] = await Promise.all([
    getCurrentUser(),
    getCurrentFirm(),
    getEngagement(parsed.data.engagementId),
  ]);
  if (!user || !firm || !engagement || engagement.firm_id !== firm.id) {
    return { ok: false, error: "not_found" };
  }

  try {
    if (parsed.data.frequency === "off") {
      // Turning repeat off = END the series (stop future spawns). Existing
      // engagements are untouched; the ledger survives so past periods can
      // never re-spawn even if repeat is turned back on later.
      if (engagement.series_id) {
        const series = await getRecurringSeries(engagement.series_id);
        if (series && series.status !== "ended") {
          await endRecurringSeries(series.id);
        }
      }
      revalidatePath(`/engagements/${engagement.id}`);
      return { ok: true };
    }

    // A series spawns engagements that must be sendable — an empty checklist
    // would create occurrences the client can't act on (the send flow itself
    // blocks zero-document engagements).
    const items = snapshotFromRequestItems(
      await listRequestItems(engagement.id),
    );
    if (items.length === 0) {
      return { ok: false, error: "no_documents" };
    }

    await applyRepeatChoice({
      engagement,
      firmTimezone: firm.timezone,
      userId: user.id,
      frequency: parsed.data.frequency,
      dueOffsetDays: parsed.data.dueOffsetDays,
      itemsSnapshot: items,
    });
    revalidatePath(`/engagements/${engagement.id}`);
    return { ok: true };
  } catch (error) {
    console.error("[setEngagementRepeatAction] failed:", error);
    return { ok: false, error: "save_failed" };
  }
}
