"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import { getEngagement } from "@/lib/db/engagements";
import { getServerSupabase } from "@/lib/supabase/server";
import {
  setEngagementStageManually,
  startPreparation,
} from "@/lib/engagements/stage-sync";
import { isEngagementStage } from "@/lib/engagements/stage";

// The two PERSON-driven stage actions. Every other transition is automatic and
// hooked into its own event handler (see stage-sync.ts) — these are the only two
// places a human moves a stage on purpose.
//
// Permissions: both roles (owner and staff) may set a stage. There is no
// narrower rule to enforce — staff already approve documents, request payment,
// and mark engagements complete, all of which move stages automatically; gating
// the manual control would be theatre. Firm scoping is what actually matters,
// and it's enforced twice: RLS on the write, plus an explicit firm_id check here
// so a forged engagement id from another firm is rejected outright rather than
// silently no-oping.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type StageActionState = { ok?: boolean; error?: string } | null;

const LOCALES = ["en", "fr"] as const;
function revalidateStagePaths(engagementId: string) {
  for (const loc of LOCALES) {
    revalidatePath(`/${loc}/engagements/${engagementId}`);
    revalidatePath(`/${loc}/engagements`);
    revalidatePath(`/${loc}/dashboard`);
  }
}

// Resolve + authorize the engagement for a stage write. Returns null when the
// caller has no business touching it.
async function authorize(
  engagementId: unknown,
): Promise<{ id: string; userId: string } | null> {
  if (typeof engagementId !== "string" || !UUID_RE.test(engagementId)) {
    return null;
  }
  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user || !firm) return null;
  const engagement = await getEngagement(engagementId);
  if (!engagement || engagement.firm_id !== firm.id) return null;
  return { id: engagementId, userId: user.id };
}

/**
 * Manual override — the accountant picks a stage from the header stepper or the
 * row menu. Recorded in stage_history against their user id.
 *
 * Not sticky: the next automatic event re-resolves from the engagement's real
 * contents and may move it again. That's deliberate — auto always reflects
 * reality, and this is a "park it here for now" control.
 */
export async function setEngagementStageAction(
  formData: FormData,
): Promise<StageActionState> {
  const stage = formData.get("stage");
  if (!isEngagementStage(stage)) return { error: "invalid" };

  const ctx = await authorize(formData.get("engagement_id"));
  if (!ctx) return { error: "not_found" };

  const ok = await setEngagementStageManually(
    await getServerSupabase(),
    ctx.id,
    stage,
    ctx.userId,
  );
  // false covers both "migration 0690 isn't applied here yet" and a genuine
  // write failure. Either way the stage did NOT change, so say so rather than
  // letting the UI show a move that didn't happen.
  if (!ok) return { error: "save_failed" };

  revalidateStagePaths(ctx.id);
  return { ok: true };
}

/**
 * "Start preparation" — the accountant declares they're working on the file,
 * without waiting to approve every last document.
 *
 * This latches an intent; it does not force a stage. If the client still owes a
 * document the engagement honestly stays at collecting and moves to
 * in_preparation by itself once the checklist clears.
 */
export async function startPreparationAction(
  formData: FormData,
): Promise<StageActionState> {
  const ctx = await authorize(formData.get("engagement_id"));
  if (!ctx) return { error: "not_found" };

  const ok = await startPreparation(
    await getServerSupabase(),
    ctx.id,
    ctx.userId,
  );
  if (!ok) return { error: "save_failed" };

  revalidateStagePaths(ctx.id);
  return { ok: true };
}
