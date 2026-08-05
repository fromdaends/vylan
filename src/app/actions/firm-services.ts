"use server";

// Server actions for the firm's service catalogue (migration 1480).
//
// Only async exports live in this file — a `"use server"` module that exports
// anything else fails the production build and nothing else catches it.

import { revalidatePath } from "next/cache";
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

export async function createFirmServiceAction(
  input: z.input<typeof ServiceSchema>,
): Promise<Result> {
  const g = await guard();
  if (!g.ok) return { ok: false, error: g.error };

  const parsed = ServiceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const res = await createFirmService(parsed.data);
  if (!res.ok) return { ok: false, needsMigration: res.needsMigration };
  revalidatePath("/templates/services");
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

  const res = await updateFirmService(id, parsed.data);
  if (!res.ok) return { ok: false, needsMigration: res.needsMigration };
  revalidatePath("/templates/services");
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
  return { ok: true };
}
