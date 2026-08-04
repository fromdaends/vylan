"use server";

// Quick links on the Overview — add one, remove one.
//
// OPEN TO EVERYONE IN THE FIRM, like the task actions: the links are a shared
// shelf, not a setting. RLS scopes every statement to the caller's firm, so
// the firmId here is belt on top of braces.
//
// This file exports async functions ONLY. A "use server" module with a sync
// export typechecks, lints, passes every test, and then fails the production
// build naming something unrelated.

import { getCurrentUser } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import {
  addFirmLink,
  deleteFirmLink,
  FirmLinksUnsupportedError,
} from "@/lib/db/firm-links";
import { normalizeLinkUrl } from "@/lib/links/url";
import { revalidateAllLocales } from "@/lib/revalidate";

export type FirmLinkActionResult = {
  ok: boolean;
  /** Set when database update 1390 has not been applied yet. */
  needsMigration?: boolean;
  error?: "no_session" | "bad_label" | "bad_url" | "failed";
};

// A label is a line on a card, not a paragraph.
const LABEL_MAX = 80;

async function guard() {
  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user || !firm) return { error: "no_session" as const };
  return { user, firm };
}

function handle(err: unknown, what: string): FirmLinkActionResult {
  if (err instanceof FirmLinksUnsupportedError) {
    return { ok: false, needsMigration: true };
  }
  console.error(`[firm-links] ${what} failed:`, err);
  return { ok: false, error: "failed" };
}

export async function addFirmLinkAction(input: {
  label: string;
  url: string;
}): Promise<FirmLinkActionResult> {
  const g = await guard();
  if ("error" in g) return { ok: false, error: g.error };

  const label =
    typeof input.label === "string"
      ? input.label.trim().replace(/\s+/g, " ").slice(0, LABEL_MAX)
      : "";
  if (!label) return { ok: false, error: "bad_label" };

  const url =
    typeof input.url === "string" ? normalizeLinkUrl(input.url) : null;
  if (!url) return { ok: false, error: "bad_url" };

  try {
    await addFirmLink({
      firmId: g.firm.id,
      label,
      url,
      createdBy: g.user.id,
    });
  } catch (err) {
    return handle(err, "add");
  }

  revalidateAllLocales("/dashboard");
  return { ok: true };
}

export async function deleteFirmLinkAction(input: {
  id: string;
}): Promise<FirmLinkActionResult> {
  const g = await guard();
  if ("error" in g) return { ok: false, error: g.error };

  try {
    await deleteFirmLink({ id: input.id, firmId: g.firm.id });
  } catch (err) {
    return handle(err, "delete");
  }

  revalidateAllLocales("/dashboard");
  return { ok: true };
}
