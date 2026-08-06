"use client";

// Create / edit a document request template — the SAME builder chrome as the
// other three.
//
// ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
//
// It was the last screen still doing its own thing. Engagement templates, task
// templates and services all wear TemplateBuilderShell: title bar, tabs, live
// preview, Back/Next. A document request template got a heading, two stacked
// cards and a Save button at the bottom.
//
// It was also TWO screens pretending to be one. `/templates/[id]` chose between
// a plain editor and a boxed-sidebar layout based on `firms.workflows_enabled`,
// a flag that defaults false and is off for every firm — so the sidebar version
// was unreachable code that still had to be kept in step with the reachable one.
//
// Both are gone. One builder, and the workflow sections appear as EXTRA TABS
// when the flag is on rather than as a different screen. Nothing was deleted to
// achieve consistency: a firm that switches workflows on still gets the
// automation, tasks and assignees editors, in the same chrome as everything
// else.
//
// ── THE PREVIEW ────────────────────────────────────────────────────────────
//
// This template makes a CHECKLIST a client is asked to fill, so it previews the
// checklist — what the client will see when the request lands, in the order it
// will land in.

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { FileText, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  TemplateBuilderShell,
  Field,
  Fieldset,
} from "@/components/templates/template-builder-shell";
import { DocTypePicker } from "@/components/engagements/doc-type-picker";
import {
  AutomationEditor,
  type EditorAspect,
  type EditorMember,
} from "@/components/workflow/automation-editor";
import { BUILTIN_NAME_KEYS } from "@/components/vylan/automations-panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  updateTemplateAction,
  saveTemplateWorkflowAction,
} from "@/app/actions/templates";
import {
  familyDefaultWorkflow,
  parseWorkflowDefinition,
  type WorkflowDefinition,
} from "@/lib/workflow/definition";
import type { Template, TemplateItem } from "@/lib/db/templates";
import type { PickerAutomation } from "@/components/templates/template-read-only";

/** Spelled out so a typo is a compile error rather than a `Templates.tab_x`
 *  rendering on screen — next-intl fails silently. */
type TabKey =
  | "tab_request_details"
  | "tab_request_documents"
  | "section_automation"
  | "section_tasks"
  | "section_assignees";

export function RequestTemplateBuilder({
  template,
  displayName,
  locale,
  /** Present only when the firm has workflows on. Empty otherwise, which is
   *  what keeps the extra tabs off the screen for everybody else. */
  automations = [],
  members = [],
  workflowsOn = false,
}: {
  template: Template;
  displayName: string;
  locale: "fr" | "en";
  automations?: PickerAutomation[];
  members?: EditorMember[];
  workflowsOn?: boolean;
}) {
  // Item labels are mirrored into both languages on save and DocTypePicker
  // localizes itself, so nothing here reads `locale` — it stays on the
  // signature because every other builder takes one and the routes pass it.
  void locale;

  const t = useTranslations("Templates");
  const tc = useTranslations("Common");
  const tEng = useTranslations("Engagements");
  const tAuto = useTranslations("Automations");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [tab, setTab] = useState("details");
  const [previewOpen, setPreviewOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(template.name);
  const [items, setItems] = useState<TemplateItem[]>(template.items);

  const initialDef = useMemo(
    () =>
      parseWorkflowDefinition(template.workflow) ??
      familyDefaultWorkflow(template.type),
    [template.workflow, template.type],
  );
  const [draft, setDraft] = useState<WorkflowDefinition>(initialDef);
  const [automationId, setAutomationId] = useState<string | null>(
    template.automation_id ?? null,
  );

  const automationName = (a: PickerAutomation) =>
    a.firmId === null && BUILTIN_NAME_KEYS[a.id]
      ? tAuto(BUILTIN_NAME_KEYS[a.id])
      : a.name;
  const provenance = automations.find((a) => a.id === automationId) ?? null;
  /** Save-back is only ever offered onto the firm's OWN automations — nobody
   *  edits a built-in. */
  const canSaveBack = provenance !== null && provenance.firmId !== null;

  const namedItems = items.filter((i) => (i.label_en || i.label_fr).trim());

  const TABS = [
    { key: "details", label: t("tab_request_details" as TabKey) },
    {
      key: "documents",
      label: t("tab_request_documents" as TabKey),
      // The one thing that makes this template worth having. A request that
      // asks for nothing is a request nobody can answer.
      incomplete: namedItems.length === 0,
    },
    ...(workflowsOn
      ? [
          { key: "automation", label: t("section_automation" as TabKey) },
          { key: "tasks", label: t("section_tasks" as TabKey) },
          { key: "assignees", label: t("section_assignees" as TabKey) },
        ]
      : []),
  ];

  const aspectFor: Record<string, EditorAspect> = {
    automation: "flow",
    tasks: "tasks",
    assignees: "assignees",
  };

  function updateItem(idx: number, patch: Partial<TemplateItem>) {
    setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
  }

  function pickAutomation(id: string) {
    const a = automations.find((x) => x.id === id);
    if (!a?.definition) return;
    // Copy-on-use: picking COPIES the flow onto this template's draft, and the
    // id is provenance. Saving is still required to persist it.
    setDraft(a.definition);
    setAutomationId(a.id);
  }

  /**
   * ONE save for the whole screen.
   *
   * The old page had two: the documents editor saved itself, and a separate
   * sticky bar saved the workflow. Two Save buttons on one screen is two
   * chances to leave with half your work — so the title bar's Save writes both,
   * and the workflow half is skipped entirely when the flag is off.
   */
  function save(saveBackToAutomation: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await updateTemplateAction({
        id: template.id,
        name,
        items: items.filter((i) => (i.label_en || i.label_fr).trim().length > 0),
      });
      if (res?.error) {
        setError(
          res.error === "missing_name"
            ? t("errors.missing_name")
            : res.error === "invalid_items"
              ? t("errors.invalid_items")
              : t("errors.update_failed"),
        );
        return;
      }

      if (workflowsOn) {
        const wf = await saveTemplateWorkflowAction({
          templateId: template.id,
          definition: draft,
          automationId,
          saveBackToAutomation,
        });
        if (!wf.ok) {
          // The documents DID save. Saying so stops somebody redoing work they
          // have already done.
          toast.error(tAuto("error_save"));
          return;
        }
      }

      toast.success(tAuto("saved_toast"));
      router.push("/templates/requests");
    });
  }

  return (
    <TemplateBuilderShell
      title={displayName}
      explainer={t("request_builder_explainer")}
      tabs={TABS}
      activeTab={tab}
      onTabChange={setTab}
      actions={[
        // The save-back choice only exists when this flow came FROM one of the
        // firm's own automations. Otherwise there is nothing to save back to.
        ...(workflowsOn && canSaveBack && provenance
          ? [
              {
                label: t("save_back_named", { name: automationName(provenance) }),
                variant: "outline" as const,
                disabled: pending,
                onClick: () => save(true),
              },
            ]
          : []),
        {
          label: pending ? tc("saving") : tc("save"),
          disabled: pending,
          onClick: () => save(false),
        },
      ]}
      onClose={() => router.push("/templates/requests")}
      previewOpen={previewOpen}
      onPreviewToggle={() => setPreviewOpen((v) => !v)}
      error={error}
      preview={
        <div className="mx-auto max-w-md space-y-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("request_preview_label")}
          </p>
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex items-center gap-1.5 border-b border-border px-4 py-2.5">
              <FileText className="size-3.5 text-muted-foreground" aria-hidden />
              <p className="text-sm font-medium">
                {name.trim() || t("template_name_label")}
              </p>
            </div>
            {namedItems.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-muted-foreground">
                {t("items_empty")}
              </p>
            ) : (
              <ul>
                {namedItems.map((item, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-3 border-b border-border px-4 py-2.5 text-sm last:border-b-0"
                  >
                    {item.label_en || item.label_fr}
                    {item.required && (
                      <span className="ml-auto shrink-0 rounded-full bg-accent-subtle px-2 py-0.5 text-[11px] text-accent">
                        {t("required_chip")}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      }
    >
      {tab === "details" && (
        <Fieldset title={t("section_details")}>
          <Field label={t("template_name_label")} htmlFor="req-tpl-name">
            <Input
              id="req-tpl-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
        </Fieldset>
      )}

      {tab === "documents" && (
        <Fieldset title={t("section_items")}>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t("request_documents_hint")}
          </p>
          {items.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border/60 px-3 py-8 text-center text-xs text-muted-foreground">
              {t("items_empty")}
            </p>
          ) : (
            <ul className="space-y-3">
              {items.map((item, idx) => (
                <li
                  key={idx}
                  className="space-y-2 rounded-lg border border-border p-3"
                >
                  {/* ONE label for the whole site — mirrored into both
                      label_fr and label_en so stored data stays consistent. */}
                  <Input
                    value={item.label_en || item.label_fr}
                    onChange={(e) =>
                      updateItem(idx, {
                        label_fr: e.target.value,
                        label_en: e.target.value,
                      })
                    }
                    placeholder={tEng("label_placeholder")}
                  />
                  <Textarea
                    value={item.description_fr ?? ""}
                    onChange={(e) =>
                      updateItem(idx, {
                        description_fr: e.target.value || null,
                      })
                    }
                    placeholder={tEng("description_fr_placeholder")}
                    rows={1}
                    className="text-xs"
                  />
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <DocTypePicker
                      value={item.doc_type}
                      onChange={(dt) => updateItem(idx, { doc_type: dt })}
                      className="h-8 w-[14rem] max-w-full text-xs"
                    />
                    <label className="flex cursor-pointer select-none items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={item.required}
                        onChange={(e) =>
                          updateItem(idx, { required: e.target.checked })
                        }
                      />
                      {tEng("required")}
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setItems((prev) => prev.filter((_, i) => i !== idx))
                      }
                      className="ml-auto inline-flex items-center gap-1 text-destructive hover:underline"
                    >
                      <Trash2 className="size-3" />
                      {tc("delete")}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              setItems((prev) => [
                ...prev,
                {
                  label_fr: "",
                  label_en: "",
                  description_fr: null,
                  description_en: null,
                  // "other" rather than null: doc_type is required, and the
                  // picker lets you narrow it once the line has a name.
                  doc_type: "other",
                  required: false,
                },
              ])
            }
          >
            <Plus className="size-3.5" />
            {t("add_item")}
          </Button>
        </Fieldset>
      )}

      {/* ── THE WORKFLOW TABS ──────────────────────────────────────────────
          Only when the firm has workflows on. They are the SAME editors the
          old boxed-sidebar layout rendered — carried across rather than
          deleted, so switching the flag on still gets you everything it used
          to, in the chrome everything else uses. */}
      {workflowsOn && tab === "automation" && (
        <Fieldset title={t("section_automation")}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {t("uses_automation")}
            </span>
            <Select value={automationId ?? "custom"} onValueChange={pickAutomation}>
              <SelectTrigger className="h-9 w-64 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {automationId == null && (
                  <SelectItem value="custom" disabled>
                    {t("uses_automation_custom")}
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
          <AutomationEditor
            value={draft}
            onChange={setDraft}
            members={members}
            aspect="flow"
          />
        </Fieldset>
      )}

      {workflowsOn && (tab === "tasks" || tab === "assignees") && (
        <Fieldset title={t(tab === "tasks" ? "section_tasks" : "section_assignees")}>
          <AutomationEditor
            value={draft}
            onChange={setDraft}
            members={members}
            aspect={aspectFor[tab]}
          />
        </Fieldset>
      )}
    </TemplateBuilderShell>
  );
}
