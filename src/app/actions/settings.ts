"use server";

import { revalidatePath } from "next/cache";
import { updateCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import { SettingsSchema, type SettingsState } from "./settings.schema";

// The auto-reject toggle on /settings used to live in a focused Server
// Action here. It moved to POST /api/firm/auto-reject because Server
// Actions auto-trigger an RSC re-render of the surrounding tree, and a
// throw anywhere in that re-render surfaces to the client as an opaque
// "Server Components render" error (digest only) in production. A plain
// fetch keeps the toggle save independent of the page render.
//
// The Zod schema + form-state type used to live here too, but Next.js 16
// forbids non-async-function exports from "use server" files. They now
// live in `./settings.schema.ts` and are re-imported below.

export async function updateFirmSettings(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  // Owner-only: firm settings (name, branding, default client language…) are
  // firm-admin, not a per-user preference. Staff are blocked here even though
  // the column-level grant would otherwise let any authenticated member write.
  const user = await getCurrentUser();
  if (!user) return { error: "no_session" };
  if (user.role !== "owner") return { error: "owner_only" };

  const parsed = SettingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[issue.path.join(".")] = issue.message;
    }
    return { fieldErrors };
  }
  try {
    await updateCurrentFirm(parsed.data);
  } catch {
    return { error: "update_failed" };
  }
  // EVERY surface that renders the firm's identity, not just the one you saved
  // from. The name, logo and brand colour are read by the app shell's sidebar,
  // the firm page header and its Settings tab, and the settings screen itself —
  // so a save that only refreshed /profile left the others showing the old
  // value out of cache until something else happened to bust it.
  //
  // The founder named this before it bit them, asking for the two firm-settings
  // surfaces to be "a mirror of each other instead of a duplicate… so when one
  // settings updates the other one does too". A shared component is half of
  // that; this is the other half. One editor, one action, and every reader
  // invalidated together.
  //
  // Root layout scope rather than a list of paths: the firm name and logo are
  // in the shell, which wraps every route, and a list would silently miss the
  // next page that renders them.
  revalidatePath("/", "layout");
  return { ok: true };
}
