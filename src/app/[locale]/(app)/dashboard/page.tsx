import { setRequestLocale } from "next-intl/server";
import { getCurrentUser } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import { listTemplates } from "@/lib/db/templates";

export const dynamic = "force-dynamic";
import { assertLocale } from "@/lib/locale";
import { formatDate } from "@/lib/format";
import { loadEngagementWorklist } from "@/lib/dashboard/worklist";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import {
  TemplatesGallery,
  type TemplateCard,
} from "@/components/dashboard/templates-gallery";
import { EngagementsWorklist } from "@/components/dashboard/engagements-worklist";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const [worklistRows, user, firm, templates] = await Promise.all([
    loadEngagementWorklist(),
    getCurrentUser(),
    getCurrentFirm(),
    listTemplates(),
  ]);

  const templateCards: TemplateCard[] = templates.map((tmpl) => ({
    id: tmpl.id,
    name: tmpl.name,
    type: tmpl.type,
    itemCount: tmpl.items.length,
    builtIn: tmpl.firm_id == null,
  }));

  // First name only — prefer the explicit display_name, fall back to the
  // account name; ignore the email local-part so an unnamed user gets the
  // friendly fallback the greeting renders instead of a raw handle.
  const rawName = user?.display_name?.trim() || user?.name?.trim() || null;
  const firstName = rawName ? (rawName.split(/\s+/)[0] ?? null) : null;

  // Greeting subtitle: firm name · today's date (carried over from the old
  // Home page greeting).
  const dateStr = formatDate(new Date(), locale, "long");
  const subtitle = firm?.name ? `${firm.name} · ${dateStr}` : dateStr;

  return (
    <div className="space-y-10 sm:space-y-12">
      <DashboardHeader firstName={firstName} subtitle={subtitle} />

      <TemplatesGallery templates={templateCards} />

      <EngagementsWorklist
        rows={worklistRows}
        currentUserId={user?.id ?? null}
        locale={locale}
      />
    </div>
  );
}
