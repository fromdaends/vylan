"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/db/users";
import { reassignEngagementAction } from "@/app/actions/engagements";

// Persisting a drop on the capacity board.
//
// ── TWO WRITES, AND ONLY ONE OF THEM IS NEW ────────────────────────────────
//
// A drop can change two things: WHO owns the card, and WHERE it sits in their
// column. The first already has an owner — `reassignEngagementAction`, which
// the row menu uses, which audit-logs and honours the assignment email. This
// calls it rather than writing `assigned_user_id` itself, because two paths
// that reassign an engagement is two paths that can disagree about whether an
// email went out.
//
// Only `board_rank` is written here, and only when the card actually moved
// within a column.
//
// ── WHY IT DOES NOT REVALIDATE ON EVERY DROP ───────────────────────────────
//
// The board is optimistic: the card is already where you dropped it before
// this is called. A `revalidatePath` on every drop would push a fresh server
// render at the exact moment you are mid-drag of the NEXT card, and the list
// would jump under the pointer. The path is revalidated only when the write
// FAILS and the board has to roll back to the truth.

const MoveSchema = z.object({
  engagementId: z.string().uuid(),
  /** Null = the Unassigned column. */
  assigneeId: z.string().uuid().nullable(),
  /** Where it landed. Null when the drop did not change the order (a pure
   *  reassign onto the end of a column nobody has ranked). */
  boardRank: z.number().finite().nullable(),
  /** Whether the owner actually changed — the caller knows, and asking the
   *  database again would be a read to answer a question we already have. */
  reassigned: z.boolean(),
});

export async function moveEngagementCardAction(
  input: z.input<typeof MoveSchema>,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "no_session" };

  const parsed = MoveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { engagementId, assigneeId, boardRank, reassigned } = parsed.data;

  if (reassigned) {
    // The audit-logged path, with its assignment email. Not a raw update.
    const res = await reassignEngagementAction(engagementId, assigneeId);
    if (!res.ok) {
      revalidatePath("/engagements");
      return { ok: false, error: res.error ?? "reassign_failed" };
    }
  }

  if (boardRank != null) {
    const sb = await getServerSupabase();
    const { error } = await sb
      .from("engagements")
      .update({ board_rank: boardRank })
      .eq("id", engagementId);
    if (error) {
      // The REASSIGN may already have succeeded above, so this is a partial
      // failure: the card is with the right person but in the wrong place.
      // Revalidating shows the truth rather than leaving the board asserting
      // an order the database never accepted.
      revalidatePath("/engagements");
      return { ok: false, error: "rank_failed" };
    }
  }

  return { ok: true };
}
