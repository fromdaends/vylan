// The firm's engagement letter, in Settings.
//
// The founder: "make sure that there's settings for these new features."
// 1580 set this up as a firm-level, do-it-ONCE thing — "the firm sets its letter
// up once and every automation reuses it" — which is the definition of a
// setting. It only ever appeared on the Vylan hub, so the one place an owner
// goes looking for firm-wide setup did not have it.
//
// ⚠️ THE SAME COMPONENT, NOT A COPY. EngagementLetterCard is rendered here and
// on /vylan, exactly as client-team-editor is rendered in two places — the
// repo's reference for this. A second uploader that drifts from the first is
// precisely what the cohesion rule forbids, and restyling the letter must stay
// one edit.

export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { assertLocale } from "@/lib/locale";
import { getCurrentUser } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import { can } from "@/lib/auth/capabilities";
import { getEngagementLetterSummary } from "@/app/actions/engagement-letters";
import { EngagementLetterCard } from "@/components/vylan/engagement-letter-card";

export default async function EngagementLetterSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const user = await getCurrentUser();
  if (!user) redirect(`/${locale}/login`);
  const firm = await getCurrentFirm();
  if (!firm) redirect(`/${locale}/dashboard`);

  const [letters, t] = await Promise.all([
    getEngagementLetterSummary(),
    getTranslations("Settings"),
  ]);

  return (
    <div className="max-w-2xl space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("letter_title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("letter_subtitle")}
        </p>
      </header>

      {/* Same gate the hub uses: uploading the firm's letter is firm setup, and
          everybody else reads what it produced. */}
      <EngagementLetterCard
        letters={letters}
        canManage={can(user, "team.manage")}
      />
    </div>
  );
}
