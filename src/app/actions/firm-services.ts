"use server";

// Server actions for the firm's service catalogue (migration 1480).
//
// Only async exports live in this file — a `"use server"` module that exports
// anything else fails the production build and nothing else catches it.

import { revalidatePath } from "next/cache";
import { createTaskTemplate } from "@/lib/db/task-templates";
import { readTaskTemplatePayload } from "@/lib/tasks/template-payload";
import { z } from "zod";
import { getCurrentUser } from "@/lib/db/users";
import { can } from "@/lib/auth/capabilities";
import {
  archiveFirmService,
  createFirmService,
  updateFirmService,
} from "@/lib/db/firm-services";

const ServiceSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().default(null),
  // Cents. Nullable = "priced per engagement", which is a real service and must
  // never be coerced to 0 — that would offer the work for free.
  rateCents: z.number().int().min(0).max(1_000_000_00).nullable(),
  rateType: z.enum(["item", "hour"]),
  /** An existing task template this service implies (1620). */
  taskTemplateId: z.string().uuid().nullable().optional(),
  /**
   * Steps typed on the service form instead of picking a template.
   *
   * Turned into a REAL task template on save, so it appears on the Task
   * templates page and any other service can reuse it — the founder's call:
   * "have it show up on your task templates too."
   */
  newWorkSteps: z.array(z.string().trim().max(200)).max(50).optional(),
  billingFrequency: z.enum([
    "once",
    "weekly",
    "monthly",
    "quarterly",
    "yearly",
  ]),
  taxPct: z.number().min(0).max(100).nullable(),
});

type Result = { ok: boolean; needsMigration?: boolean; error?: string };

/**
 * The catalogue is what the firm SELLS, so changing it is a firm-settings
 * decision rather than something anyone with an engagement can do. Same gate as
 * the other firm-wide switches.
 */
async function guard(): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "unauthenticated" };
  if (!can(user, "firm.settings")) return { ok: false, error: "forbidden" };
  return { ok: true };
}

/**
 * Turn steps typed on the SERVICE form into a real task template.
 *
 * The founder: "have it show up on your task templates too". So this creates an
 * ordinary `task_templates` row — not a hidden per-service variant. One kind of
 * object, visible on the Task templates page, reusable by any other service.
 *
 * Named after the service, because that is what somebody typing steps into
 * "Monthly Bookkeeping" would look for later.
 *
 * Returns the new id, or null when there was nothing to make. NEVER throws: a
 * service must still save if the template write fails, and a service with no
 * work is a perfectly ordinary service.
 */
async function workTemplateFor(
  serviceName: string,
  steps: string[] | undefined,
): Promise<string | null> {
  const titles = (steps ?? []).map((x) => x.trim()).filter(Boolean);
  if (titles.length === 0) return null;
  try {
    const payload = readTaskTemplatePayload({
      subtasks: titles.map((title) => ({ title })),
    });
    const res = await createTaskTemplate({
      name: serviceName,
      access: "team",
      payload,
    });
    return res.ok ? res.id : null;
  } catch (e) {
    console.error("[firm-services] inline work template failed:", e);
    return null;
  }
}

export async function createFirmServiceAction(
  input: z.input<typeof ServiceSchema>,
): Promise<Result> {
  const g = await guard();
  if (!g.ok) return { ok: false, error: g.error };

  const parsed = ServiceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  // Steps typed inline win over a picked template — somebody who typed them
  // meant them.
  const madeId = await workTemplateFor(parsed.data.name, parsed.data.newWorkSteps);

  const res = await createFirmService({
    ...parsed.data,
    ...(madeId ? { taskTemplateId: madeId } : {}),
  });
  if (!res.ok) return { ok: false, needsMigration: res.needsMigration };
  revalidatePath("/templates/services");
  // A service can now MAKE a task template, so that page is stale too.
  revalidatePath("/templates/tasks");
  return { ok: true };
}

export async function updateFirmServiceAction(
  id: string,
  input: z.input<typeof ServiceSchema>,
): Promise<Result> {
  const g = await guard();
  if (!g.ok) return { ok: false, error: g.error };

  const parsed = ServiceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const madeId = await workTemplateFor(parsed.data.name, parsed.data.newWorkSteps);

  const res = await updateFirmService(id, {
    ...parsed.data,
    ...(madeId ? { taskTemplateId: madeId } : {}),
  });
  if (!res.ok) return { ok: false, needsMigration: res.needsMigration };
  revalidatePath("/templates/services");
  // A service can now MAKE a task template, so that page is stale too.
  revalidatePath("/templates/tasks");
  return { ok: true };
}

export async function archiveFirmServiceAction(
  id: string,
  archived: boolean,
): Promise<Result> {
  const g = await guard();
  if (!g.ok) return { ok: false, error: g.error };

  const res = await archiveFirmService(id, archived);
  if (!res.ok) return { ok: false, needsMigration: res.needsMigration };
  revalidatePath("/templates/services");
  // A service can now MAKE a task template, so that page is stale too.
  revalidatePath("/templates/tasks");
  return { ok: true };
}
