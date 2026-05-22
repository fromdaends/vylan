"use server";

// Public demo qualifying form — server action that drives the
// progressive-save behaviour. The whole point of this flow is that
// even if a prospect bails halfway, the founder still has their
// email and firm name for follow-up.
//
// Step 1 -> insert a new row, return the id to the client.
// Step 2 -> update the same row, bump furthest_step to 2.
// Step 3 -> update the same row, bump furthest_step to 3.
//
// The founder is notified on Step 1 (new lead arrived) and again on
// Step 3 (qualified lead, ready to book). Phase 3 of the build
// improves the email content; this file just wires the trigger
// points. Email failures never block the form submission — the row
// is what matters.

import { headers } from "next/headers";
import {
  DemoStep1Schema,
  DemoStep2Schema,
  DemoStep3Schema,
} from "@/app/actions/demo-request.schema";
import {
  createDemoRequest,
  updateDemoRequest,
  getDemoRequest,
  type DemoRequest,
} from "@/lib/db/demo-requests";
import {
  checkRateLimit,
  ipFromRequest,
  DEMO_FORM_PER_IP,
} from "@/lib/rate-limit";
import {
  notifyFounderNewLead,
  notifyFounderQualifiedLead,
} from "@/lib/demo-notify";

export type SaveDemoStepResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

type Step1Args = { step: 1; data: unknown; existingId?: undefined };
type Step2Args = { step: 2; data: unknown; existingId: string };
type Step3Args = { step: 3; data: unknown; existingId: string };
export type SaveDemoStepArgs = Step1Args | Step2Args | Step3Args;

export async function saveDemoStep(
  args: SaveDemoStepArgs,
): Promise<SaveDemoStepResult> {
  // Rate-limit by IP. Same key shape across steps so a prospect
  // walking through all 3 only counts once... actually no, three
  // submissions per filled-out form is realistic, the 15/hour limit
  // still leaves room for ~5 prospects.
  const h = await headers();
  const ip = ipFromRequest({ headers: { get: (n) => h.get(n) } });
  const rl = await checkRateLimit({
    key: `demo:ip:${ip}`,
    ...DEMO_FORM_PER_IP,
  });
  if (!rl.ok) return { ok: false, error: "rate_limited" };

  if (args.step === 1) {
    const parsed = DemoStep1Schema.safeParse(args.data);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "invalid",
      };
    }
    const row = await createDemoRequest(parsed.data);
    if (!row) return { ok: false, error: "save_failed" };

    // Notify the founder asynchronously — never block the form on
    // email delivery.
    void notifyFounderNewLead(row).catch((e) => {
      console.error("[saveDemoStep] notifyFounderNewLead failed:", e);
    });

    return { ok: true, id: row.id };
  }

  if (args.step === 2) {
    if (!args.existingId) {
      return { ok: false, error: "missing_id" };
    }
    const parsed = DemoStep2Schema.safeParse(args.data);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "invalid",
      };
    }
    // Guard: the row must exist (a stale id from a bookmarked tab
    // shouldn't silently create a new path).
    const existing = await getDemoRequest(args.existingId);
    if (!existing) return { ok: false, error: "not_found" };

    const row = await updateDemoRequest(args.existingId, {
      firm_size: parsed.data.firm_size,
      client_volume: parsed.data.client_volume,
      current_tool: parsed.data.current_tool,
      current_tool_other:
        parsed.data.current_tool === "other_software"
          ? (parsed.data.current_tool_other ?? null)
          : null,
      // furthest_step only moves forward, never backwards (so the
      // funnel metric stays meaningful even if a prospect goes Back).
      furthest_step: Math.max(existing.furthest_step, 2) as 1 | 2 | 3,
    });
    if (!row) return { ok: false, error: "save_failed" };
    return { ok: true, id: row.id };
  }

  // step === 3
  if (!args.existingId) {
    return { ok: false, error: "missing_id" };
  }
  const parsed = DemoStep3Schema.safeParse(args.data);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "invalid",
    };
  }
  const existing = await getDemoRequest(args.existingId);
  if (!existing) return { ok: false, error: "not_found" };

  const row = await updateDemoRequest(args.existingId, {
    phone: parsed.data.phone?.trim() ? parsed.data.phone.trim() : null,
    province: parsed.data.province,
    preferred_language: parsed.data.preferred_language,
    marketing_opt_in: parsed.data.marketing_opt_in,
    furthest_step: Math.max(existing.furthest_step, 3) as 1 | 2 | 3,
  });
  if (!row) return { ok: false, error: "save_failed" };

  void notifyFounderQualifiedLead(row).catch((e) => {
    console.error("[saveDemoStep] notifyFounderQualifiedLead failed:", e);
  });

  return { ok: true, id: row.id };
}

// Called from the cal.com embed's booking-success callback (Phase 4).
// Separate action because the inputs (just the row id) are different
// and we don't want to re-route through saveDemoStep.
export async function markDemoBooked(
  id: string,
): Promise<{ ok: true; row: DemoRequest } | { ok: false; error: string }> {
  if (!id || typeof id !== "string") {
    return { ok: false, error: "missing_id" };
  }
  const row = await updateDemoRequest(id, { booked_at: new Date().toISOString() });
  if (!row) return { ok: false, error: "save_failed" };
  // Phase 3 also notifies on booking; we wire the trigger but the
  // content of that email lives in the notify module.
  void (async () => {
    try {
      const { notifyFounderDemoBooked } = await import("@/lib/demo-notify");
      await notifyFounderDemoBooked(row);
    } catch (e) {
      console.error("[markDemoBooked] notifyFounderDemoBooked failed:", e);
    }
  })();
  return { ok: true, row };
}
