import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { assertLocale } from "@/lib/locale";
import { AutomatedJobsPanel } from "@/components/vylan/automated-jobs-panel";

// The "Vylan" hub: the firm's own automation surface, reached from the rail's
// Sparkles tab.
//
// It used to carry two tabs — Automated jobs and Document filing. Filing has
// moved to /files?tab=settings, next to the documents it actually files: a firm
// setting a folder template wants the browser one click away to see what it did,
// and filing was always a stranger here.
//
// With one panel left, the tab strip is GONE rather than rendered as a strip of
// one. A single "tab" is not navigation, it is furniture that implies a
// sibling that no longer exists.
//
// ?tab=filing still arrives here from bookmarks, older emails, and any storage
// OAuth callback that has not been redeployed, so it forwards rather than 404s.
export const dynamic = "force-dynamic";

export default async function VylanHubPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  const sp = await searchParams;
  if (sp.tab === "filing") {
    redirect({ href: "/files?tab=settings", locale });
  }

  setRequestLocale(locale);
  const t = await getTranslations("VylanHub");

  return (
    <div className="mx-auto max-w-4xl animate-in-fade">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {t("page_title")}
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground sm:text-base">
          {t("page_subtitle")}
        </p>
      </header>

      <AutomatedJobsPanel />
    </div>
  );
}
