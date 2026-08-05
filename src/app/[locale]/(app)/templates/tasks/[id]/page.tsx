import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { assertLocale } from "@/lib/locale";
import { getTaskTemplate } from "@/lib/db/task-templates";
import { listTemplates } from "@/lib/db/templates";
import { localizedTemplateName } from "@/lib/templates/builtin-names";
import { TaskTemplateBuilder } from "@/components/templates/task-template-builder";

/**
 * Edit a task template — the SAME builder that creates one, seeded.
 *
 * The founder's rule: viewing and editing are the same thing, so clicking a row
 * lands here. A second edit screen would be a second place for the fields to
 * drift.
 */
export default async function EditTaskTemplatePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const [template, templates] = await Promise.all([
    getTaskTemplate(id),
    listTemplates(),
  ]);

  // RLS decides visibility, so "not found" and "private, belongs to somebody
  // else" arrive here identically — which is right, and neither answer leaks
  // the other's existence.
  if (!template) notFound();

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
      initial={{
        id: template.id,
        name: template.name,
        access: template.access,
        payload: template.payload,
      }}
    />
  );
}
