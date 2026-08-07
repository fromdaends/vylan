"use server";

// The automations library's mutations — create, rename/edit, clone, archive.
//
// Any firm member may manage the library, the same rule as templates and
// tasks: RLS scopes every write to the caller's firm, and built-ins
// (firm_id null) are structurally un-writable by anyone. Definitions are run
// through the total parser on the way in, so nothing malformed can be saved —
// and therefore nothing malformed can ever reach the engine.

import {
  archiveAutomation,
  createAutomation,
  getAutomation,
  updateAutomation,
} from "@/lib/db/automations";
import {
  parseWorkflowDefinition,
  returnTypeWorkflow,
} from "@/lib/workflow/definition";
import { getCurrentUser } from "@/lib/db/users";
import { logUserActivity } from "@/lib/db/activity";
import { revalidateAllLocales } from "@/lib/revalidate";

export type AutomationActionState =
  | { ok: true; id?: string }
  | { ok: false; error: "no_session" | "invalid" | "builtin" | "save_failed" };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const name = v.trim();
  if (name.length < 1 || name.length > 120) return null;
  return name;
}

/**
 * New automation. A reviewed AI draft's definition wins when supplied (run
 * through the total parser like every other write); else a base flow's copy
 * when one is named (any visible automation, built-ins included); else the
 * return-type default — the same rule the spec gives new custom templates.
 */
export async function createAutomationAction(input: {
  name: string;
  baseId?: string | null;
  definition?: unknown;
}): Promise<AutomationActionState> {
  const user = await getCurrentUser();
  if (!user?.firm_id) return { ok: false, error: "no_session" };
  const name = cleanName(input.name);
  if (!name) return { ok: false, error: "invalid" };

  try {
    let definition = returnTypeWorkflow();
    let fromDraft = false;
    if (input.definition !== undefined) {
      const parsed = parseWorkflowDefinition(input.definition);
      if (!parsed) return { ok: false, error: "invalid" };
      definition = parsed;
      fromDraft = true;
    } else if (typeof input.baseId === "string" && UUID_RE.test(input.baseId)) {
      const base = await getAutomation(input.baseId);
      if (base?.definition) definition = base.definition;
    }
    const created = await createAutomation({ name, definition });
    await logUserActivity(user.firm_id, null, "automation_created", {
      automation_id: created.id,
      name,
      base_id: input.baseId ?? null,
      ...(fromDraft ? { from_ai_draft: true } : {}),
    });
    revalidateAllLocales("/vylan");
    return { ok: true, id: created.id };
  } catch (e) {
    console.error("[automations] create failed:", e);
    return { ok: false, error: "save_failed" };
  }
}

/**
 * Draft a flow from a plain-language description — or refine an existing
 * draft with a change request. PERSISTS NOTHING: the caller renders the
 * result in the editor and the human decides whether it becomes a row
 * (createAutomationAction with the reviewed definition). Rate-limited by
 * being human-clicked and single-shot; the total parser inside draft.ts is
 * the safety gate.
 */
export async function draftAutomationAction(input: {
  description: string;
  locale: "en" | "fr";
  current?: unknown;
  instruction?: string | null;
}): Promise<
  | {
      ok: true;
      name: string;
      summaryEn: string;
      summaryFr: string;
      definition: unknown;
    }
  | {
      ok: false;
      error:
        | "no_session"
        | "invalid"
        | "not_configured"
        | "rate_limited"
        | "draft_failed";
    }
> {
  const user = await getCurrentUser();
  if (!user?.firm_id) return { ok: false, error: "no_session" };
  const description =
    typeof input.description === "string" ? input.description.trim() : "";
  if (description.length < 10 || description.length > 2000) {
    return { ok: false, error: "invalid" };
  }

  // Same money guards as the assistant route (its exact rule: a trial firm
  // must not burn unbounded paid calls outside its cap, and the count is
  // reserved BEFORE the call so a crash costs us, not the founder). Plus a
  // modest per-user limiter — this is a human-clicked button, not an API.
  const [{ checkRateLimit }, { getFirmAiUsage, incrementFirmAiUsage }] =
    await Promise.all([import("@/lib/rate-limit"), import("@/lib/ai/usage")]);
  const limit = await checkRateLimit({
    key: `automation-draft:${user.id}`,
    limit: 20,
    window: "1 h",
  });
  if (!limit.ok) return { ok: false, error: "rate_limited" };
  const aiUsage = await getFirmAiUsage(user.firm_id);
  if (aiUsage.paused) return { ok: false, error: "rate_limited" };
  if (aiUsage.isTrial) await incrementFirmAiUsage(user.firm_id);

  // The refine payload rides the prompt; a definition is small by nature and
  // anything huge is either abuse or a mistake — both get "invalid", not a
  // maximum-cost API call.
  const current =
    input.current !== undefined
      ? parseWorkflowDefinition(input.current)
      : null;
  if (current && JSON.stringify(current).length > 20_000) {
    return { ok: false, error: "invalid" };
  }

  const { draftWorkflowFromDescription } = await import(
    "@/lib/workflow/draft"
  );
  const res = await draftWorkflowFromDescription({
    description,
    locale: input.locale === "fr" ? "fr" : "en",
    current,
    instruction:
      typeof input.instruction === "string" ? input.instruction : null,
  });
  if (!res.ok) {
    await logUserActivity(user.firm_id, null, "automation_draft_failed", {
      reason: res.reason,
    });
    return {
      ok: false,
      error: res.reason === "not_configured" ? "not_configured" : "draft_failed",
    };
  }
  await logUserActivity(user.firm_id, null, "automation_drafted", {
    refined: Boolean(input.instruction),
  });
  return {
    ok: true,
    name: res.name,
    summaryEn: res.summaryEn,
    summaryFr: res.summaryFr,
    definition: res.definition,
  };
}

/** Rename and/or replace the definition of one of the firm's own automations. */
export async function updateAutomationAction(input: {
  id: string;
  name?: string;
  definition?: unknown;
}): Promise<AutomationActionState> {
  const user = await getCurrentUser();
  if (!user?.firm_id) return { ok: false, error: "no_session" };
  if (typeof input.id !== "string" || !UUID_RE.test(input.id)) {
    return { ok: false, error: "invalid" };
  }

  const patch: { name?: string; definition?: ReturnType<typeof returnTypeWorkflow> } =
    {};
  if (input.name !== undefined) {
    const name = cleanName(input.name);
    if (!name) return { ok: false, error: "invalid" };
    patch.name = name;
  }
  if (input.definition !== undefined) {
    const def = parseWorkflowDefinition(input.definition);
    if (!def) return { ok: false, error: "invalid" };
    patch.definition = def;
  }
  if (Object.keys(patch).length === 0) return { ok: true };

  try {
    const existing = await getAutomation(input.id);
    if (!existing) return { ok: false, error: "invalid" };
    if (existing.firmId === null) return { ok: false, error: "builtin" };
    await updateAutomation(input.id, patch);
    await logUserActivity(user.firm_id, null, "automation_updated", {
      automation_id: input.id,
      ...(patch.name ? { name: patch.name } : {}),
      edited_definition: patch.definition != null,
    });
    revalidateAllLocales("/vylan");
    return { ok: true };
  } catch (e) {
    console.error("[automations] update failed:", e);
    return { ok: false, error: "save_failed" };
  }
}

/**
 * Clone — the only way to "edit" a built-in, and handy for variants of your
 * own ("Rush T1 — no review step" starts from Tax return flow).
 */
export async function cloneAutomationAction(input: {
  id: string;
  name: string;
}): Promise<AutomationActionState> {
  const user = await getCurrentUser();
  if (!user?.firm_id) return { ok: false, error: "no_session" };
  const name = cleanName(input.name);
  if (!name) return { ok: false, error: "invalid" };
  if (typeof input.id !== "string" || !UUID_RE.test(input.id)) {
    return { ok: false, error: "invalid" };
  }

  try {
    const source = await getAutomation(input.id);
    if (!source?.definition) return { ok: false, error: "invalid" };
    const created = await createAutomation({
      name,
      definition: source.definition,
    });
    await logUserActivity(user.firm_id, null, "automation_created", {
      automation_id: created.id,
      name,
      cloned_from: input.id,
    });
    revalidateAllLocales("/vylan");
    return { ok: true, id: created.id };
  } catch (e) {
    console.error("[automations] clone failed:", e);
    return { ok: false, error: "save_failed" };
  }
}

/**
 * Retire, never delete: engagements and templates keep their provenance
 * pointers, and their own COPIES of the definition keep working regardless.
 */
export async function archiveAutomationAction(input: {
  id: string;
}): Promise<AutomationActionState> {
  const user = await getCurrentUser();
  if (!user?.firm_id) return { ok: false, error: "no_session" };
  if (typeof input.id !== "string" || !UUID_RE.test(input.id)) {
    return { ok: false, error: "invalid" };
  }
  try {
    const existing = await getAutomation(input.id);
    if (!existing) return { ok: false, error: "invalid" };
    if (existing.firmId === null) return { ok: false, error: "builtin" };
    await archiveAutomation(input.id);
    await logUserActivity(user.firm_id, null, "automation_archived", {
      automation_id: input.id,
      name: existing.name,
    });
    revalidateAllLocales("/vylan");
    return { ok: true };
  } catch (e) {
    console.error("[automations] archive failed:", e);
    return { ok: false, error: "save_failed" };
  }
}
