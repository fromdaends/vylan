import { redirect } from "next/navigation";
import { getPathname } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import { getTranslations } from "next-intl/server";
import { HelpSidebar } from "@/components/help/help-sidebar";
import { KeyboardShortcuts } from "@/components/help/keyboard-shortcuts";
import { AppShell } from "@/components/app/app-shell";

export default async function AppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    redirect(getPathname({ locale, href: "/login" }));
  }

  const dbUser = await getCurrentUser();
  const firm = await getCurrentFirm();

  if (!dbUser || !firm || !firm.onboarded_at) {
    redirect(getPathname({ locale, href: "/onboarding" }));
  }

  const t = await getTranslations("App");
  const tAuth = await getTranslations("Auth");

  const initials = firm.name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <AppShell
      firmName={firm.name}
      firmInitials={initials}
      brandColor={firm.brand_color}
      labels={{
        dashboard: t("nav_dashboard"),
        clients: t("nav_clients"),
        templates: t("nav_templates"),
        billing: t("nav_billing"),
        settings: t("nav_settings"),
        logout: tAuth("logout"),
      }}
    >
      {children}
      <HelpSidebar />
      <KeyboardShortcuts />
    </AppShell>
  );
}
