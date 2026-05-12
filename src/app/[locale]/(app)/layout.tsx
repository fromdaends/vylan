import { redirect } from "next/navigation";
import { getPathname, Link } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import { brand } from "@/lib/brand";
import { getTranslations } from "next-intl/server";
import { logoutAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { HelpSidebar } from "@/components/help/help-sidebar";
import { KeyboardShortcuts } from "@/components/help/keyboard-shortcuts";

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
    <div className="flex-1 flex flex-col">
      <header className="border-b border-border bg-card">
        <div className="mx-auto max-w-6xl flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="font-semibold tracking-tight">
              {brand.name}
            </Link>
            <nav className="hidden sm:flex items-center gap-4 text-sm text-muted-foreground">
              <Link href="/dashboard" className="hover:text-foreground">
                {t("nav_dashboard")}
              </Link>
              <Link href="/clients" className="hover:text-foreground">
                {t("nav_clients")}
              </Link>
              <Link href="/templates" className="hover:text-foreground">
                {t("nav_templates")}
              </Link>
              <Link href="/settings" className="hover:text-foreground">
                {t("nav_settings")}
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <div
              className="size-7 rounded-full flex items-center justify-center font-medium text-primary-foreground"
              style={{ backgroundColor: firm.brand_color }}
              aria-label={firm.name}
              title={firm.name}
            >
              {initials}
            </div>
            <span className="hidden sm:inline text-muted-foreground">
              {firm.name}
            </span>
            <form action={logoutAction}>
              <Button type="submit" variant="ghost" size="sm">
                {tAuth("logout")}
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-6xl px-6 py-8">
        {children}
      </main>
      <HelpSidebar />
      <KeyboardShortcuts />
    </div>
  );
}
