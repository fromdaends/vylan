"use client";

// Task templates on the Templates page (migration 1570) — list, create, retire.
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
// The parent's NAME is the template's name. Canopy has both, and two name
// fields on one small form is a question nobody wants asked twice.

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Plus, Trash2, ListChecks, CornerDownRight } from "lucide-react";
import { TaskTemplateRow } from "@/components/templates/task-template-row";
import { TemplateRowList } from "@/components/templates/template-row";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TASK_KIND_META, taskKindLabelKey } from "@/lib/tasks/kinds";
import type { TaskKind } from "@/lib/db/engagement-tasks";
import type { TaskTemplate } from "@/lib/db/task-templates";
import type { TemplateChecklistItem } from "@/lib/engagements/template-payload";
import { saveTaskTemplateAction } from "@/app/actions/task-templates";

export function TaskTemplateCatalogue({
  templates,
  requestTemplates = [],
  locale,
  openOnMount = false,
}: {
  templates: TaskTemplate[];
  /**
   * The firm's document-request templates — Canopy's "Client request
   * templates". Applying one COPIES its lines onto the parent task.
   */
  requestTemplates?: {
    id: string;
    name: string;
    items: TemplateChecklistItem[];
  }[];
  locale: "en" | "fr";
  /** The + Create panel links straight here with the form already open. */
  openOnMount?: boolean;
}) {
  const t = useTranslations("Templates");
  const tEng = useTranslations("Engagements");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [open, setOpen] = useState(openOnMount);
  // Set while editing one that already exists; null while creating.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [access, setAccess] = useState<"team" | "private">("team");
  const [kind, setKind] = useState<TaskKind>("task");
  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState<string[]>([""]);
  const [checklist, setChecklist] = useState<TemplateChecklistItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const usableSteps = steps.map((s) => s.trim()).filter((s) => s.length > 0);
  // A parent with neither steps nor a client request is a name attached to
  // nothing — the same rule isWorthSavingTaskTemplate applies on the server.
  const canSave =
    name.trim().length > 0 &&
    (usableSteps.length > 0 || checklist.length > 0);

  function reset() {
    setEditingId(null);
    setName("");
    setAccess("team");
    setKind("task");
    setDescription("");
    setSteps([""]);
    setChecklist([]);
    setError(null);
  }

  function save() {
    if (!canSave) return;
    setError(null);
    startTransition(async () => {
      const res = await saveTaskTemplateAction({
        // Present => update the existing one. Absent => create. Without this an
        // edit would leave the original behind as a duplicate.
        ...(editingId ? { id: editingId } : {}),
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
        setError(res.needsMigration ? "needs_migration" : "failed");
        return;
      }
      reset();
      setOpen(false);
      router.refresh();
    });
  }

  const label = (k: TaskKind) => tEng(taskKindLabelKey(k) as "kind_task");

  return (
    <div className="space-y-4">
      {templates.length === 0 && !open ? (
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
          <Button type="button" size="sm" onClick={() => setOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            {t("task_templates_new")}
          </Button>
        </div>
      ) : (
        <>
          <TemplateRowList>
            {templates.map((tpl) => (
              <TaskTemplateRow
                key={tpl.id}
                id={tpl.id}
                name={tpl.name}
                isPrivate={tpl.access === "private"}
                // The steps themselves, in order — the template is short enough
                // that a count would say less than the list.
                meta={[
                  tpl.payload.subtasks.map((x) => x.title).join(" · "),
                  tpl.payload.checklist.length > 0
                    ? t("documents_count", { count: tpl.payload.checklist.length })
                    : "",
                ]
                  .filter(Boolean)
                  .join(" — ")}
                onEdit={() => {
                  // Load it into the SAME inline form that creates one. A
                  // second edit form would be a second place for the fields to
                  // drift.
                  setEditingId(tpl.id);
                  setName(tpl.name);
                  setAccess(tpl.access);
                  setKind(tpl.payload.kind);
                  setDescription(tpl.payload.description);
                  setSteps(
                    tpl.payload.subtasks.length > 0
                      ? tpl.payload.subtasks.map((x) => x.title)
                      : [""],
                  );
                  setChecklist(tpl.payload.checklist);
                  setOpen(true);
                }}
              />
            ))}
          </TemplateRowList>
          {!open && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setOpen(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              {t("task_templates_new")}
            </Button>
          )}
        </>
      )}

      {open && (
        <div className="space-y-4 rounded-xl border border-border bg-card p-4">
          {/* ── THE PARENT TASK ─────────────────────────────────────────── */}
          <div className="space-y-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("task_templates_name_placeholder")}
              aria-label={t("task_templates_name_placeholder")}
            />
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as TaskKind)}
                aria-label={tEng("task_kind_label")}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              >
                {/* Every kind, including the one-per-engagement ones. A template
                    is not an engagement — that limit applies when the tasks are
                    created, and the builder's own picker enforces it there. */}
                {TASK_KIND_META.map((meta) => (
                  <option key={meta.kind} value={meta.kind}>
                    {label(meta.kind)}
                  </option>
                ))}
              </select>
              <label className="flex cursor-pointer select-none items-center gap-1.5">
                <input
                  type="radio"
                  name="task-template-access"
                  checked={access === "team"}
                  onChange={() => setAccess("team")}
                />
                {t("access_team")}
              </label>
              <label className="flex cursor-pointer select-none items-center gap-1.5">
                <input
                  type="radio"
                  name="task-template-access"
                  checked={access === "private"}
                  onChange={() => setAccess("private")}
                />
                {t("access_private")}
              </label>
            </div>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("task_template_description_placeholder")}
              aria-label={t("task_template_description_placeholder")}
              rows={2}
              className="text-xs"
            />
          </div>

          {/* ── THE STEPS UNDER IT ──────────────────────────────────────── */}
          <div className="space-y-2 border-l-2 border-border pl-3">
            <p className="text-xs font-medium text-muted-foreground">
              {t("task_template_steps")}
            </p>
            <ul className="space-y-2">
              {steps.map((step, idx) => (
                <li key={idx} className="flex items-center gap-2">
                  <CornerDownRight
                    className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
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
                        prev.length === 1
                          ? prev
                          : prev.filter((_, i) => i !== idx),
                      )
                    }
                    disabled={steps.length === 1}
                    className="text-muted-foreground transition-colors hover:text-destructive disabled:opacity-30"
                    aria-label={t("remove")}
                  >
                    <Trash2 className="h-4 w-4" />
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
              <Plus className="h-3.5 w-3.5" />
              {t("task_template_add_step")}
            </Button>
          </div>

          {/* ── THE CLIENT REQUEST THE PARENT CARRIES ───────────────────── */}
          {requestTemplates.length > 0 && (
            <div className="space-y-2 border-l-2 border-border pl-3">
              <p className="text-xs font-medium text-muted-foreground">
                {t("task_template_client_request")}
              </p>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <select
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
                  aria-label={t("task_template_apply_request")}
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                >
                  <option value="">{t("task_template_apply_request")}</option>
                  {requestTemplates.map((rt) => (
                    <option key={rt.id} value={rt.id}>
                      {rt.name}
                    </option>
                  ))}
                </select>
                {checklist.length > 0 && (
                  <>
                    <span className="text-muted-foreground">
                      {checklist
                        .slice(0, 4)
                        .map((c) =>
                          locale === "fr"
                            ? c.label_fr || c.label_en
                            : c.label_en || c.label_fr,
                        )
                        .join(" · ")}
                      {checklist.length > 4 && ` +${checklist.length - 4}`}
                    </span>
                    <button
                      type="button"
                      onClick={() => setChecklist([])}
                      className="text-muted-foreground underline transition-colors hover:text-destructive"
                    >
                      {t("remove")}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {error && (
            <p className="text-xs text-destructive">
              {error === "needs_migration"
                ? t("task_templates_needs_migration")
                : t("task_templates_save_failed")}
            </p>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-border/50 pt-3">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                reset();
                setOpen(false);
              }}
            >
              {t("cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!canSave || pending}
              onClick={save}
            >
              {t("task_templates_save")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
