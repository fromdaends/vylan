"use client";

// Task templates on the Templates page (migration 1570) — LIST ONLY.
//
// ── THE SHAPE ──────────────────────────────────────────────────────────────
//
// One PARENT TASK with steps and a client request under it, which is Canopy's
// shape (support article 12573386) and what the founder asked for after seeing
// the two side by side.
//
// It was a flat list of sibling tasks first. That put five rows on the Work
// list for every client at month-end instead of one you expand — and left the
// whole job's assignee and due date with nowhere to live. The parent fixes
// both. Vylan's database already had `engagement_tasks.parent_id`; only the
// template could not express it.
//
// ── WHY THE FORM LEFT THIS FILE ────────────────────────────────────────────
//
// It used to hold the whole authoring form inline: a card that unfolded under
// the list, with bare inputs, no tabs and a footer of its own. That is why the
// founder said the builders did not look like each other — "ALL THE UIS FOR
// BUILDING EVERYTHING TEMPLATES SHOULD ALL BE THE SAME."
//
// A form living inside a list can never share chrome with a full screen, so it
// moved to /templates/tasks/new and /templates/tasks/<id> on
// TemplateBuilderShell, the same frame the engagement and service builders use.
// What is left here is the list — which is all this file was ever named for.

import { useTranslations } from "next-intl";
import { Plus, ListChecks } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { TaskTemplateRow } from "@/components/templates/task-template-row";
import { SearchableTemplates } from "@/components/templates/searchable-templates";
import { Button } from "@/components/ui/button";
import type { TaskTemplate } from "@/lib/db/task-templates";

export function TaskTemplateCatalogue({
  templates,
}: {
  templates: TaskTemplate[];
}) {
  const t = useTranslations("Templates");

  return (
    // The SAME header, search box and rows as every other Templates page.
    // The founder: "what the UI looks like when you click on an engagement
    // template and a task template is not the same. So it should be."
    <SearchableTemplates
      // Team and Private only: task templates carry an access level but have no
      // draft concept, and an always-empty "Drafts (0)" would be a filter over
      // a distinction that does not exist.
      tabs={["team", "private"]}
      title={t("section_task_templates")}
      subtitle={t("task_templates_subtitle")}
      action={
        <Button type="button" size="sm" asChild>
          <Link href="/templates/tasks/new">
            <Plus className="h-3.5 w-3.5" />
            {t("task_templates_new")}
          </Link>
        </Button>
      }
      sections={[
        {
          key: "all",
          primary: true,
          title: t("section_task_templates"),
          cards: templates.map((tpl) => ({
            id: tpl.id,
            group:
              tpl.access === "private" ? ("private" as const) : ("team" as const),
            // Findable by name AND by its steps — searching "reconcile" should
            // find the close template that contains it.
            terms: [
              tpl.name,
              tpl.payload.description,
              ...tpl.payload.subtasks.map((x) => x.title),
            ].join(" "),
            node: (
              <TaskTemplateRow
                key={tpl.id}
                id={tpl.id}
                name={tpl.name}
                meta={[
                  tpl.payload.subtasks.map((x) => x.title).join(" · "),
                  tpl.payload.checklist.length > 0
                    ? t("documents_count", {
                        count: tpl.payload.checklist.length,
                      })
                    : "",
                ]
                  .filter(Boolean)
                  .join(" — ")}
              />
            ),
          })),
          empty: (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border/60 bg-card/30 px-6 py-12 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <ListChecks className="h-5 w-5" />
              </span>
              <p className="text-sm font-medium text-foreground">
                {t("task_templates_empty")}
              </p>
              <p className="mx-auto max-w-md text-xs leading-relaxed text-muted-foreground">
                {t("task_templates_empty_hint")}
              </p>
              <Button type="button" size="sm" asChild>
                <Link href="/templates/tasks/new">
                  <Plus className="h-3.5 w-3.5" />
                  {t("task_templates_new")}
                </Link>
              </Button>
            </div>
          ),
        },
      ]}
    />
  );
}
