"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getServerSupabase, getServiceRoleSupabase } from "@/lib/supabase/server";
import { getCurrentFirm, updateCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import { getPathname } from "@/i18n/navigation";
import { parseEmailList } from "@/lib/validators";
import { trialEndsAtFrom } from "@/lib/trial";
import {
  findPilotInvite,
  pilotFirmFields,
  markPilotInviteRedeemed,
} from "@/lib/pilot-invites";
import { notifyFounderNewSignup } from "@/lib/demo-notify";
import { createInvite } from "@/app/actions/team";

export type OnboardingState = {
  error?: string;
  fieldErrors?: Record<string, string>;
} | null;

const Step1Schema = z.object({
  firm_name: z.string().min(2, "min_2_chars").max(120, "too_long"),
  brand_color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "invalid_color")
    .default("#1e293b"),
});

const Step2Schema = z.object({
  timezone: z.string().min(2, "required"),
  locale_default: z.enum(["fr", "en"]),
});

const Step3Schema = z.object({
  emails: z.string().optional().default(""),
});

function pickLocale(formData: FormData): "fr" | "en" {
  // English is the default for a new firm/client unless French is explicitly
  // chosen (Vylan serves all of Canada; French stays a first-class option).
  const v = formData.get("locale");
  return v === "fr" ? "fr" : "en";
}

function fieldErrorsFromZod(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

function localPath(
  locale: "fr" | "en",
  pathname: string,
  query?: Record<string, string>,
): string {
  return getPathname({ locale, href: { pathname, query } });
}

export async function submitStep1(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const parsed = Step1Schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFromZod(parsed.error) };
  }
  const locale = pickLocale(formData);

  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: "no_session" };

  const userMetaName =
    (auth.user.user_metadata?.name as string | undefined)?.trim() ||
    auth.user.email!.split("@")[0];
  // Default a brand-new firm/owner to English unless French was explicitly set
  // at signup (Canada-wide default; French stays available in settings).
  const userMetaLocale =
    auth.user.user_metadata?.locale === "fr" ? "fr" : "en";

  const existingFirm = await getCurrentFirm();

  if (!existingFirm) {
    // Use service-role client: migration 0009 removed permissive INSERT
    // policies on `firms` and `users`, so first-time onboarding must bypass
    // RLS through the server-side service-role path.
    const admin = getServiceRoleSupabase();
    // Has this email been pre-authorised for a pilot (migration 1490)? Applied
    // HERE, at the instant the firm is created, rather than flipped by hand
    // afterwards: until someone notices the signup and goes and flips it, the
    // firm is an ordinary trial capped at ten AI checks for its LIFETIME, so a
    // pilot who signs up on a Friday burns the whole allowance before anyone is
    // watching and reports the ceiling as a bug. Null (no invite, or any lookup
    // failure at all) means an ordinary trial — see findPilotInvite.
    const invite = await findPilotInvite(auth.user.email);
    const pilot = invite ? pilotFirmFields(invite, Date.now()) : null;

    // Every firm created from the public signup flow starts a 14-day free
    // trial with full access. is_demo = true marks it "unconverted" (drives
    // the trial banner + the day-14 "book a meeting" gate) until they convert
    // to a paid plan. Existing/paid firms keep is_demo = false from the
    // migration default. A pilot is still is_demo and still unconverted — it
    // just runs longer and meters monthly instead of on the lifetime ceiling.
    const baseFirm = {
      name: parsed.data.firm_name,
      brand_color: parsed.data.brand_color,
      locale_default: userMetaLocale,
      plan: "trial",
      is_demo: true,
      // New accounts start with both document auto-rejects ON (founder
      // default): unreadable/incomplete/wrong-document uploads and exact
      // duplicates are auto-bounced back to the client instead of queued for
      // review. Set explicitly here (the firms columns default false, 0029 /
      // 0270) — onboarding is the only firm-creation path, so this is what new
      // accounts get. Existing firms keep whatever they've chosen.
      auto_reject_unusable_docs: true,
      auto_reject_duplicates: true,
    };

    let created = await admin
      .from("firms")
      .insert(
        pilot
          ? {
              ...baseFirm,
              trial_ends_at: pilot.trial_ends_at,
              is_pilot: true,
              ai_monthly_cap: pilot.ai_monthly_cap,
            }
          : { ...baseFirm, trial_ends_at: trialEndsAtFrom(Date.now()) },
      )
      .select("id")
      .single();
    // If the pilot columns are what broke the insert (1250 not applied on this
    // database), retry as an ordinary trial rather than refusing to create the
    // account. A misconfigured pilot must cost someone a smaller allowance, not
    // the ability to sign up at all.
    let pilotApplied = pilot !== null;
    if (created.error && pilot) {
      created = await admin
        .from("firms")
        .insert({ ...baseFirm, trial_ends_at: trialEndsAtFrom(Date.now()) })
        .select("id")
        .single();
      // The fallback firm is an ordinary trial, so the invite was NOT consumed
      // and must stay outstanding — otherwise it is marked redeemed against a
      // firm that never got the pilot terms, and the mistake is invisible.
      pilotApplied = false;
    }
    const firm = created.data;
    if (created.error || !firm) {
      return { error: "create_failed" };
    }

    const { error: userErr } = await admin.from("users").insert({
      id: auth.user.id,
      firm_id: firm.id,
      email: auth.user.email!,
      name: userMetaName,
      role: "owner",
      locale: userMetaLocale,
    });
    if (userErr) {
      return { error: "create_failed" };
    }
    // Consume the invite only once the account is fully formed (firm AND owner
    // row), and only if the pilot terms actually landed. Best-effort: the
    // account already exists, so a failure here must not surface as a signup
    // error — worst case the invite stays outstanding, which is visible in the
    // table rather than silent.
    if (pilotApplied && auth.user.email) {
      await markPilotInviteRedeemed(auth.user.email, firm.id);
    }
    // No demo seeding: a free-trial firm gets a real, empty workspace and
    // brings in its own clients.
  } else {
    await updateCurrentFirm({
      name: parsed.data.firm_name,
      brand_color: parsed.data.brand_color,
    });
  }

  revalidatePath("/", "layout");
  redirect(localPath(locale, "/onboarding", { step: "2" }));
}

export async function submitStep2(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const parsed = Step2Schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFromZod(parsed.error) };
  }
  await updateCurrentFirm({
    timezone: parsed.data.timezone,
    locale_default: parsed.data.locale_default,
  });
  const locale = pickLocale(formData);
  redirect(localPath(locale, "/onboarding", { step: "3" }));
}

export async function submitStep3(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const parsed = Step3Schema.safeParse({
    emails: formData.get("emails") ?? "",
  });
  if (!parsed.success) {
    return { error: "invalid" };
  }
  const emails = parseEmailList(parsed.data.emails);
  await updateCurrentFirm({ onboarded_at: new Date().toISOString() });
  await notifyFounderOfSignup();
  // Send real invitations for any colleagues entered (Phase 7 — replaces the
  // old "invites coming soon" stub that only stashed them in invited_emails).
  // Best-effort: onboarding must not fail on an email hiccup, and createInvite
  // respects the seat cap + returns a result instead of throwing on
  // over-cap / duplicate / already-a-user.
  for (const email of emails) {
    try {
      const fd = new FormData();
      fd.set("email", email);
      await createInvite(fd);
    } catch (e) {
      console.error("[onboarding] invite failed:", e);
    }
  }
  revalidatePath("/", "layout");
  const locale = pickLocale(formData);
  redirect(localPath(locale, "/dashboard"));
}

// Notify the founder that a prospect just finished signing up — with the firm
// ID + login email needed to bill + activate them in Stripe. Demo signups
// only: those are the accounts that go through the manual sales/activation
// flow. The welcome-to-the-user email is no longer sent from here — it now
// goes out the moment the user first lands signed-in, even if they never
// reach this step (see src/lib/welcome.ts).
async function notifyFounderOfSignup(): Promise<void> {
  const [user, firm] = await Promise.all([
    getCurrentUser(),
    getCurrentFirm(),
  ]);
  if (!user?.email || !firm) return;
  if (!firm.is_demo) return;
  after(() =>
    notifyFounderNewSignup({
      firmId: firm.id,
      firmName: firm.name,
      ownerName: user.name || user.email.split("@")[0],
      ownerEmail: user.email,
    }),
  );
}

export async function skipStep(formData: FormData) {
  const step = Number(formData.get("step")) as 1 | 2 | 3;
  const locale = pickLocale(formData);

  if (step >= 3) {
    await updateCurrentFirm({ onboarded_at: new Date().toISOString() });
    await notifyFounderOfSignup();
    revalidatePath("/", "layout");
    redirect(localPath(locale, "/dashboard"));
  }
  redirect(localPath(locale, "/onboarding", { step: String(step + 1) }));
}
