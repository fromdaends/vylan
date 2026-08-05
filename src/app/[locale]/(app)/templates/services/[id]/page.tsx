import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { assertLocale } from "@/lib/locale";
import { getFirmService } from "@/lib/db/firm-services";
import { listTaskTemplates } from "@/lib/db/task-templates";
import { getCurrentUser } from "@/lib/db/users";
import { can } from "@/lib/auth/capabilities";
import { ServiceBuilder } from "@/components/templates/service-builder";

/**
 * Edit a service — the SAME builder that creates one, seeded.
 *
 * The founder's rule: viewing and editing are the same thing, so clicking a row
 * lands here.
 */
export default async function EditServicePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const [service, user, taskTemplates] = await Promise.all([
    getFirmService(id),
    getCurrentUser(),
    listTaskTemplates(),
  ]);

  if (user == null || !can(user, "firm.settings")) notFound();
  if (!service) notFound();

  return (
    <ServiceBuilder
      locale={locale}
      taskTemplates={taskTemplates.map((tt) => ({
        id: tt.id,
        name: tt.name,
        steps: tt.payload.subtasks.map((x) => x.title),
      }))}
      initial={{
        id: service.id,
        name: service.name,
        description: service.description,
        rateCents: service.rateCents,
        rateType: service.rateType,
        billingFrequency: service.billingFrequency,
        taxPct: service.taxPct,
        taskTemplateId: service.taskTemplateId,
      }}
    />
  );
}
