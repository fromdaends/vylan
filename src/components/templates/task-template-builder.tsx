"use client";

// Create / edit a task template — the SAME builder chrome as everything else.
//
// ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
//
// The founder: "ALL THE UIS FOR BUILDING EVERYTHING TEMPLATES SHOULD ALL BE
// THE SAME. STOP BUILDING INCONSISTENT THINGS."
//
// A task template used to be authored in a small card that unfolded under the
// list — no tabs, no preview, bare inputs, a footer of its own. An engagement
// template got a full screen with tabs and a live preview. Same act, two rooms.
//
// This is the same act in the same room: TemplateBuilderShell draws the frame,
// this file supplies three tabs and the fields in them. When the frame changes,
// this follows without being touched — the founder again: "when one thing
// changes on one part the rest should follow."
//
// ── THE PREVIEW ────────────────────────────────────────────────────────────
//
// An engagement template previews the proposal, because that is what it makes.
// A task template makes WORK, so it previews the work: the parent task as it
// will land on an engagement, its steps beneath it, and the documents it asks
// the client for. Same panel, same place, showing this builder's own object.

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { CornerDownRight, FileText, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import {
  TemplateBuilderShell,
  Field,
  Fieldset,
  Segmented,
} from "@/components/templates/template-builder-shell";
import { saveTaskTemplateAction } from "@/app/actions/task-templates";
import { TASK_KIND_META, taskKindLabelKey } from "@/lib/tasks/kinds";
import type { TaskKind } from "@/lib/db/engagement-tasks";
import type { TemplateChecklistItem } from "@/lib/engagements/template-payload";
import type { TaskTemplatePayload } from "@/lib/tasks/template-payload";

const TABS = ["details", "steps", "documents"] as const;
type Tab = (typeof TABS)[number];

// Spelled out so a typo is a compile error rather than a `Templates.tab_x`
// rendering on screen — next-intl fails silently, and this repo has shipped
// that bug twice.
type TabKey = "tab_task_details" | "tab_task_steps" | "tab_task_documents";

type StepDescKey =
  | "step_desc_task_details"
  | "step_desc_task_steps"
  | "step_desc_task_documents";

export type RequestTemplateOption = {
  id: string;
  name: string;
  items: TemplateChecklistItem[];
};

export function TaskTemplateBuilder({
  locale,
  requestTemplates = [],
  initial,
}: {
  locale: "en" | "fr";
  /** Canopy's "Client request templates" — a task template can carry one, and
   *  its lines are COPIED in at edit time rather than referenced. */
  requestTemplates?: RequestTemplateOption[];
  /** Present when editing. Absent when creating. */
  initial?: {
    id: string;
    name: string;
    access: "team" | "private";
    payload: TaskTemplatePayload;
  };
}) {
  const t = useTranslations("Templates");
  const tEng = useTranslations("Engagements");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [tab, setTab] = useState<Tab>("details");
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(initial?.name ?? "");
  const [access, setAccess] = useState<"team" | "private">(
    initial?.access ?? "team",
  );
  const [kind, setKind] = useState<TaskKind>(initial?.payload.kind ?? "task");
  const [description, setDescription] = useState(
    initial?.payload.description ?? "",
  );
  const [steps, setSteps] = useState<string[]>(
    initial && initial.payload.subtasks.length > 0
      ? initial.payload.subtasks.map((x) => x.title)
      : [""],
  );
  const [checklist, setChecklist] = useState<TemplateChecklistItem[]>(
    initial?.payload.checklist ?? [],
  );

  const usableSteps = useMemo(
    () => steps.map((x) => x.trim()).filter(Boolean),
    [steps],
  );
  const canSave = name.trim().length > 0;
  const label = (k: TaskKind) => tEng(taskKindLabelKey(k) as "kind_task");
  const lineLabel = (c: TemplateChecklistItem) =>
    locale === "fr" ? c.label_fr || c.label_en : c.label_en || c.label_fr;

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await saveTaskTemplateAction({
        id: initial?.id,
        name: name.trim(),
        access,
        kind,
        description: description.trim(),
        subtasks: usableSteps.map((title) => ({ title })),
        checklist,
      });
      if (!res.ok) {
        // needsMigration is its own message: "it didn't work" is unhelpful when
        // the cause is a migration the founder has not run yet.
        setError(
          res.needsMigration
            ? t("task_templates_needs_migration")
            : t("task_templates_save_failed"),
        );
        return;
      }
      router.push("/templates/tasks");
    });
  }

  return (
    <TemplateBuilderShell
      title={
        initial ? t("edit_task_template") : t("create_task_template")
      }
      kicker={t("kicker_task_template")}
      explainer={t("task_template_builder_explainer")}
      tabs={TABS.map((key) => ({
        key,
        label: t(`tab_task_${key}` as TabKey),
        description: t(`step_desc_task_${key}` as StepDescKey),
        // Only the name stops you saving, so only its step can be incomplete.
        incomplete: key === "details" && name.trim().length === 0,
      }))}
      activeTab={tab}
      onTabChange={(key) => setTab(key as Tab)}
      finalAction={{
        label: t("task_templates_save"),
        disabled: !canSave || pending,
        onClick: save,
      }}
      onClose={() => router.push("/templates/tasks")}
      previewLabel={t("task_template_preview_label")}
      error={error}
      preview={
        <div className="mx-auto max-w-md space-y-4">
          {/* The work as it will land on an engagement. */}
          <div className="rounded-xl border border-border bg-card p-4">
            {/* Absent, not "a task called Template name". Echoing the field's
                placeholder here makes an empty builder look like it is already
                previewing something real. */}
            <p
              className={cn(
                "text-sm",
                name.trim() ? "font-medium" : "italic text-muted-foreground",
              )}
            >
              {name.trim() || t("preview_unnamed_task")}
            </p>
            <p className="mt-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
              {label(kind)}
            </p>
            {description.trim() && (
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {description.trim()}
              </p>
            )}
            {usableSteps.length > 0 && (
              <ul className="mt-3 space-y-1.5 border-l-2 border-border pl-3">
                {usableSteps.map((step, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-1.5 text-xs text-muted-foreground"
                  >
                    <CornerDownRight
                      className="mt-0.5 size-3 shrink-0"
                      aria-hidden
                    />
                    {step}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {checklist.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="flex items-center gap-1.5 text-xs font-medium">
                <FileText className="size-3.5 text-muted-foreground" aria-hidden />
                {t("task_template_client_request")}
              </p>
              <ul className="mt-2 space-y-1">
                {checklist.map((c, i) => (
                  <li key={i} className="text-xs text-muted-foreground">
                    {lineLabel(c)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      }
    >
      {tab === "details" && (
        <>
          <Fieldset title={t("template_details")}>
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <Field
                label={t("template_name_label")}
                htmlFor="task-tpl-name"
                required
              >
                <Input
                  id="task-tpl-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("task_templates_name_placeholder")}
                />
              </Field>
              <Field label={t("template_access")}>
                <Segmented
                  value={access}
                  onChange={setAccess}
                  label={t("template_access")}
                  options={[
                    { value: "team" as const, label: t("access_team") },
                    { value: "private" as const, label: t("access_private") },
                  ]}
                />
              </Field>
            </div>
          </Fieldset>

          <Fieldset title={t("tab_task_details")}>
            <Field label={tEng("task_kind_label")} htmlFor="task-tpl-kind">
              <select
                id="task-tpl-kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as TaskKind)}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                {/* Every kind, including the one-per-engagement ones. A template
                    is not an engagement — that limit applies when the tasks are
                    created, and the engagement builder enforces it there. */}
                {TASK_KIND_META.map((meta) => (
                  <option key={meta.kind} value={meta.kind}>
                    {label(meta.kind)}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label={t("task_template_description_label")}
              htmlFor="task-tpl-description"
            >
              <Textarea
                id="task-tpl-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("task_template_description_placeholder")}
                rows={3}
              />
            </Field>
          </Fieldset>
        </>
      )}

      {tab === "steps" && (
        <Fieldset title={t("task_template_steps")}>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t("task_template_steps_hint")}
          </p>
          <ul className="space-y-2">
            {steps.map((step, idx) => (
              <li key={idx} className="flex items-center gap-2">
                <CornerDownRight
                  className="size-3.5 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  value={step}
                  onChange={(e) =>
                    setSteps((prev) =>
                      prev.map((s, i) => (i === idx ? e.target.value : s)),
                    )
                  }
                  placeholder={t("task_template_step_placeholder")}
                  aria-label={t("task_template_step_placeholder")}
                  className="flex-1"
                />
                <button
                  type="button"
                  onClick={() =>
                    setSteps((prev) =>
                      prev.length === 1 ? prev : prev.filter((_, i) => i !== idx),
                    )
                  }
                  disabled={steps.length === 1}
                  className="text-muted-foreground transition-colors hover:text-destructive disabled:opacity-30"
                  aria-label={t("remove")}
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setSteps((prev) => [...prev, ""])}
          >
            <Plus className="size-3.5" />
            {t("task_template_add_step")}
          </Button>
        </Fieldset>
      )}

      {tab === "documents" && (
        <Fieldset title={t("task_template_client_request")}>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t("task_template_client_request_hint")}
          </p>
          {requestTemplates.length > 0 && (
            <Field
              label={t("task_template_apply_request")}
              htmlFor="task-tpl-request"
            >
              <select
                id="task-tpl-request"
                // Resets after each apply so the same request template can be
                // applied twice; a select already holding the value fires no
                // change event.
                value=""
                onChange={(e) => {
                  const picked = requestTemplates.find(
                    (x) => x.id === e.target.value,
                  );
                  if (picked) setChecklist([...picked.items]);
                }}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="">{t("task_template_apply_request")}</option>
                {requestTemplates.map((rt) => (
                  <option key={rt.id} value={rt.id}>
                    {rt.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {checklist.length > 0 ? (
            <ul className="space-y-1.5">
              {checklist.map((c, idx) => (
                <li
                  key={idx}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
                >
                  <span className="min-w-0 truncate text-sm">
                    {lineLabel(c)}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setChecklist((prev) => prev.filter((_, i) => i !== idx))
                    }
                    className="shrink-0 text-muted-foreground transition-colors hover:text-destructive"
                    aria-label={t("remove")}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-lg border border-dashed border-border/60 px-3 py-6 text-center text-xs text-muted-foreground">
              {t("task_template_no_request")}
            </p>
          )}
        </Fieldset>
      )}
    </TemplateBuilderShell>
  );
}
