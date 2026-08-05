import { getTranslations, setRequestLocale } from "next-intl/server";
import { assertLocale } from "@/lib/locale";
import { listFirmServices } from "@/lib/db/firm-services";
import { listTaskTemplates } from "@/lib/db/task-templates";
import { getCurrentUser } from "@/lib/db/users";
import { can } from "@/lib/auth/capabilities";
import { ServiceCatalogue } from "@/components/templates/service-catalogue";
import {
  TemplatesPageShell,
  TemplatesPageHeader,
} from "@/components/templates/templates-chrome";

/**
 * Services — what the firm sells, and what it costs. Canopy calls this an
 * "Engagement Item".
 */
export default async function ServiceTemplatesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  /** `?new=1` from the + Create panel opens the dialog on arrival. */
  searchParams: Promise<{ new?: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);
  const sp = await searchParams;

  const [services, user, taskTemplates] = await Promise.all([
    listFirmServices(),
    getCurrentUser(),
    // So a service can name the work it implies (1620). Empty hides the picker.
    listTaskTemplates(),
  ]);
  // Editing what the firm SELLS is a firm-settings decision, not something
  // anyone with an engagement can do. The server action enforces this too —
  // this only decides whether the controls are drawn.
  const canManageServices = user != null && can(user, "firm.settings");

  const tEng = await getTranslations("Engagements");

  return (
    <TemplatesPageShell>
      <TemplatesPageHeader
        title={tEng("services_title")}
        subtitle={tEng("services_subtitle")}
      />
      <ServiceCatalogue
        services={services}
        taskTemplates={taskTemplates.map((tt) => ({
          id: tt.id,
          name: tt.name,
          // The steps travel WITH the name so the service form can show what
          // it just attached rather than only what it is called.
          steps: tt.payload.subtasks.map((x) => x.title),
        }))}
        locale={locale}
        canManage={canManageServices}
        openOnMount={sp.new != null}
      />
    </TemplatesPageShell>
  );
}
