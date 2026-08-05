import { setRequestLocale } from "next-intl/server";
import { assertLocale } from "@/lib/locale";
import { listTemplates } from "@/lib/db/templates";
import { localizedTemplateName } from "@/lib/templates/builtin-names";
import { TaskTemplateBuilder } from "@/components/templates/task-template-builder";

/**
 * Create a task template.
 *
 * Its OWN route now, like an engagement template's. It used to be a card that
 * unfolded under the list, which is precisely why the founder said the builders
 * did not look like each other — a form inside a list cannot have the same
 * chrome as a full screen, so it grew its own.
 */
export default async function NewTaskTemplatePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  // Canopy's "Client request templates" — the same list the Client requests
  // page renders. A task template can carry one, copied in at edit time.
  const templates = await listTemplates();

  return (
    <TaskTemplateBuilder
      locale={locale}
      requestTemplates={templates.map((tmpl) => ({
        id: tmpl.id,
        name: localizedTemplateName(tmpl, locale),
        items: tmpl.items.map((it) => ({
          label_en: it.label_en,
          label_fr: it.label_fr,
          description_en: it.description_en ?? null,
          description_fr: it.description_fr ?? null,
          doc_type: it.doc_type ?? null,
          required: it.required,
        })),
      }))}
    />
  );
}
