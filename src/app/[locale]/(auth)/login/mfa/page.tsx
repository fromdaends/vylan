import { redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getPathname } from "@/i18n/navigation";
import { assertLocale } from "@/lib/locale";
import { MfaChallengeForm } from "./mfa-challenge-form";

export const dynamic = "force-dynamic";

export default async function MfaChallengePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    redirect(getPathname({ locale, href: "/login" }));
  }

  // Skip the challenge if the user has no MFA factor enrolled. This page
  // is only reachable post-password when MFA is required; visiting it
  // otherwise should just bounce to the app.
  const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (
    !aalData ||
    aalData.currentLevel === aalData.nextLevel ||
    aalData.nextLevel !== "aal2"
  ) {
    redirect(getPathname({ locale, href: "/home" }));
  }

  const t = await getTranslations("Auth");

  return (
    <div>
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("mfa_challenge_title")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("mfa_challenge_subtitle")}
        </p>
      </div>
      <MfaChallengeForm locale={locale} />
    </div>
  );
}
