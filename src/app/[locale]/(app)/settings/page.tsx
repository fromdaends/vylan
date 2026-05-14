import { redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/db/users";
import { getPathname } from "@/i18n/navigation";
import { assertLocale } from "@/lib/locale";
import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

// /settings is now a slim "preferences" page: theme + UI language. Anything
// firm-level (name, brand color, timezone, default client locale) lives on
// /profile under "Your firm". This keeps the model simple — your firm info
// is yours to edit, system preferences are just preferences.
export default async function SettingsPage({
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
  const user = await getCurrentUser();
  if (!user) {
    redirect(getPathname({ locale, href: "/onboarding" }));
  }

  const t = await getTranslations("Settings");

  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-in-up">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground mt-1.5">{t("subtitle")}</p>
      </header>

      <SettingsForm currentLocale={user.locale} />
    </div>
  );
}
