import { setRequestLocale } from "next-intl/server";
import { assertLocale } from "@/lib/locale";
import { listTaskTemplates } from "@/lib/db/task-templates";
import { listTemplates } from "@/lib/db/templates";
import { localizedTemplateName } from "@/lib/templates/builtin-names";
import { TaskTemplateCatalogue } from "@/components/templates/task-template-catalogue";
import { TemplatesPageShell } from "@/components/templates/templates-chrome";

/**
 * Task templates — the steps a piece of work takes.
 *
 * Loads the document-request templates too, because a task template can carry a
 * CLIENT REQUEST (Canopy article 9375953): the request is attached from inside
 * the task and its lines are copied in at edit time.
 */
export default async function TaskTemplatesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  /** `?new=1` from the + Create panel opens the form on arrival. */
  searchParams: Promise<{ new?: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);
  const sp = await searchParams;

  const [taskTemplates, templates] = await Promise.all([
    listTaskTemplates(),
    listTemplates(),
  ]);

  return (
    <TemplatesPageShell>
      <TaskTemplateCatalogue
        templates={taskTemplates}
        locale={locale}
        // Canopy's "Client request templates" — the same list the Client
        // requests page renders. A task template can carry one, copied in.
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
        openOnMount={sp.new != null}
      />
    </TemplatesPageShell>
  );
}
