"use client";

// The template detail page — the founder's sketch, built: a boxed sidebar on
// the left (Documents · Automation · Tasks · Assignees) and the selected
// section on the right, with the whole workflow editable from here.
//
// The three workflow sections render the SAME AutomationEditor the library
// uses, narrowed by its aspect prop, over ONE shared draft — flipping a
// switch under Automation and adding a to-do under Tasks are edits to the
// same object, saved together.
//
// SAVE-BACK, the founder's two-button prompt: edits are local to this
// template until saved. When the template's flow came from one of the firm's
// own automations, saving offers "keep for this template only" or "also save
// back to '<name>'" — copy-on-use with an explicit hand back, never a silent
// ripple. Built-in provenance gets no save-back (nobody edits a built-in).
//
// Built-in TEMPLATES render everything read-only with Clone to customize —
// the same one-step door the templates list already has.

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Copy, FileText, ListChecks, Users, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/cn";
import { TemplateEditor } from "@/components/templates/template-editor";
import {
  AutomationEditor,
  type EditorAspect,
  type EditorMember,
} from "@/components/workflow/automation-editor";
import { BUILTIN_NAME_KEYS } from "@/components/vylan/automations-panel";
import {
  cloneTemplateAndOpenAction,
  saveTemplateWorkflowAction,
} from "@/app/actions/templates";
import {
  familyDefaultWorkflow,
  parseWorkflowDefinition,
  type WorkflowDefinition,
} from "@/lib/workflow/definition";
import type { Template } from "@/lib/db/templates";

type SectionId = "documents" | "automation" | "tasks" | "assignees";

export type PickerAutomation = {
  id: string;
  firmId: string | null;
  name: string;
  definition: WorkflowDefinition | null;
};

export function TemplateDetailShell({
  template,
  displayName,
  automations,
  members,
  locale,
}: {
  template: Template;
  /** Localized name (built-ins store French; the UI localizes by id). */
  displayName: string;
  automations: PickerAutomation[];
  members: EditorMember[];
  locale: "fr" | "en";
}) {
  const t = useTranslations("Automations");
  const tT = useTranslations("Templates");
  const readOnly = template.firm_id == null;

  const initialDef = useMemo(
    () =>
      parseWorkflowDefinition(template.workflow) ??
      familyDefaultWorkflow(template.type),
    [template.workflow, template.type],
  );
  const [section, setSection] = useState<SectionId>("documents");
  const [draft, setDraft] = useState<WorkflowDefinition>(initialDef);
  const [automationId, setAutomationId] = useState<string | null>(
    template.automation_id ?? null,
  );
  // What the last save (or first load) looked like — dirtiness is a fact
  // about divergence from THIS, not from the automation. State, not a ref:
  // it participates in render (the save bar appears from it).
  const [savedState, setSavedState] = useState(() => ({
    def: JSON.stringify(initialDef),
    automationId: template.automation_id ?? null,
  }));
  const dirty =
    JSON.stringify(draft) !== savedState.def ||
    (automationId ?? null) !== savedState.automationId;

  const [busy, startTransition] = useTransition();

  const automationName = (a: PickerAutomation) =>
    a.firmId === null && BUILTIN_NAME_KEYS[a.id]
      ? t(BUILTIN_NAME_KEYS[a.id])
      : a.name;
  const provenance = automations.find((a) => a.id === automationId) ?? null;
  // Save-back is only offered onto the firm's own automations.
  const canSaveBack = provenance !== null && provenance.firmId !== null;

  const taskCount = Object.values(draft.stages).reduce(
    (n, s) => n + s.tasks.length,
    0,
  );

  function pickAutomation(id: string) {
    const a = automations.find((x) => x.id === id);
    if (!a?.definition) return;
    // Copy-on-use: picking COPIES the flow onto this template's draft; the id
    // is provenance. Anything previously edited here is replaced — that is
    // what picking means, and Save is still required to persist it.
    setDraft(a.definition);
    setAutomationId(a.id);
  }

  function save(saveBack: boolean) {
    startTransition(async () => {
      const res = await saveTemplateWorkflowAction({
        templateId: template.id,
        definition: draft,
        automationId,
        saveBackToAutomation: saveBack,
      });
      if (res.ok) {
        setSavedState({
          def: JSON.stringify(draft),
          automationId: automationId ?? null,
        });
        toast.success(
          saveBack && res.savedBack && provenance
            ? t("saved_back_toast", { name: automationName(provenance) })
            : t("saved_toast"),
        );
      } else {
        toast.error(t("error_save"));
      }
    });
  }

  const sections: {
    id: SectionId;
    label: string;
    icon: typeof FileText;
    count?: number;
  }[] = [
    {
      id: "documents",
      label: tT("section_documents"),
      icon: FileText,
      count: template.items.length,
    },
    { id: "automation", label: tT("section_automation"), icon: Zap },
    {
      id: "tasks",
      label: tT("section_tasks"),
      icon: ListChecks,
      count: taskCount,
    },
    { id: "assignees", label: tT("section_assignees"), icon: Users },
  ];

  const aspectFor: Partial<Record<SectionId, EditorAspect>> = {
    automation: "flow",
    tasks: "tasks",
    assignees: "assignees",
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{displayName}</h1>
        {readOnly && (
          <>
            <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
              {tT("builtin_chip")}
            </span>
            <form action={cloneTemplateAndOpenAction} className="ml-auto">
              <input type="hidden" name="id" value={template.id} />
              <input type="hidden" name="__app_locale" value={locale} />
              <Button type="submit" size="sm" variant="outline">
                <Copy className="mr-1.5 size-3.5" aria-hidden />
                {t("clone_to_customize")}
              </Button>
            </form>
          </>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-[17rem_minmax(0,1fr)]">
        {/* The boxed sidebar from the founder's sketch. Fixed width — a table
            of contents gains nothing from growing on a wide screen. */}
        <nav
          aria-label={tT("sections_nav")}
          className="h-fit rounded-xl border border-border p-2"
        >
          {sections.map(({ id, label, icon: Icon, count }) => (
            <button
              key={id}
              type="button"
              onClick={() => setSection(id)}
              aria-current={section === id ? "page" : undefined}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                section === id
                  ? "bg-accent-subtle font-medium text-accent"
                  : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              {label}
              {count !== undefined && (
                <span className="ml-auto text-xs text-muted-foreground">
                  {count}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="min-w-0">
          {section === "documents" ? (
            readOnly ? (
              <ReadOnlyItems template={template} locale={locale} />
            ) : (
              <TemplateEditor template={template} locale={locale} />
            )
          ) : (
            <>
              {section === "automation" && (
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    {tT("uses_automation")}
                  </span>
                  <Select
                    value={automationId ?? "custom"}
                    onValueChange={pickAutomation}
                    disabled={readOnly}
                  >
                    <SelectTrigger className="h-9 w-64 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {automationId == null && (
                        <SelectItem value="custom" disabled>
                          {tT("uses_automation_custom")}
                        </SelectItem>
                      )}
                      {automations.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {automationName(a)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <AutomationEditor
                value={draft}
                onChange={setDraft}
                members={members}
                disabled={readOnly}
                aspect={aspectFor[section] ?? "flow"}
              />
            </>
          )}
        </div>
      </div>

      {/* The save bar — only when something actually changed, on any of the
          three workflow sections. Documents saves through its own editor. */}
      {!readOnly && dirty && section !== "documents" && (
        <div className="sticky bottom-4 mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-accent/40 bg-accent-subtle p-3 backdrop-blur">
          <span className="text-sm text-accent">{tT("workflow_changed")}</span>
          <div className="ml-auto flex items-center gap-2">
            {canSaveBack && provenance ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => save(false)}
                >
                  {tT("keep_for_template")}
                </Button>
                <Button size="sm" disabled={busy} onClick={() => save(true)}>
                  {tT("save_back_named", { name: automationName(provenance) })}
                </Button>
              </>
            ) : (
              <Button size="sm" disabled={busy} onClick={() => save(false)}>
                {t("save")}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// A built-in's document list, readable without the editor's machinery.
//
// EXPORTED because the workflows-off route needs the identical rendering: a
// built-in is read-only in both worlds, and two versions of "show me what is in
// this template" would be two things to keep in step.
export function ReadOnlyItems({
  template,
  locale,
}: {
  template: Template;
  locale: "fr" | "en";
}) {
  const tT = useTranslations("Templates");
  return (
    <ul className="overflow-hidden rounded-xl border border-border">
      {template.items.map((item, i) => (
        <li
          key={i}
          className="flex items-center gap-3 border-b border-border px-4 py-2.5 text-sm last:border-b-0"
        >
          {locale === "en" ? item.label_en : item.label_fr}
          {item.required && (
            <span className="ml-auto rounded-full bg-accent-subtle px-2 py-0.5 text-[11px] text-accent">
              {tT("required_chip")}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
