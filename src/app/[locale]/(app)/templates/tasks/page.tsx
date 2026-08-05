import { setRequestLocale } from "next-intl/server";
import { assertLocale } from "@/lib/locale";
import { listTaskTemplates } from "@/lib/db/task-templates";
import { TaskTemplateCatalogue } from "@/components/templates/task-template-catalogue";
import { TemplatesPageShell } from "@/components/templates/templates-chrome";

/**
 * Task templates — the steps a piece of work takes.
 *
 * A LIST now, nothing more. Authoring one moved to /templates/tasks/new and
 * /templates/tasks/<id>, where it uses the same builder chrome as every other
 * template. It used to be a form that unfolded inside this page, which is the
 * whole reason the builders stopped looking like each other.
 *
 * The document-request templates that a task can carry are loaded by the
 * builder routes, not here — this page no longer authors anything.
 */
export default async function TaskTemplatesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  setRequestLocale(assertLocale(rawLocale));

  const taskTemplates = await listTaskTemplates();

  return (
    <TemplatesPageShell>
      <TaskTemplateCatalogue templates={taskTemplates} />
    </TemplatesPageShell>
  );
}
