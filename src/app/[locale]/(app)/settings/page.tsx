import { getCurrentFirm } from "@/lib/db/firms";
import { setRequestLocale } from "next-intl/server";
import { SettingsForm } from "./settings-form";
import { assertLocale } from "@/lib/locale";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);
  const firm = await getCurrentFirm();
  if (!firm) return null;

  return (
    <SettingsForm
      locale={locale}
      initial={{
        name: firm.name,
        brand_color: firm.brand_color,
        timezone: firm.timezone,
        locale_default: firm.locale_default,
      }}
    />
  );
}
