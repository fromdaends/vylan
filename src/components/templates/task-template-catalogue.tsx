"use client";

// Task templates on the Templates page (migration 1570) — list, create, retire.
//
// Modelled on ServiceCatalogue rather than on the document-template cards: like
// the service catalogue, this is a short list of small things you edit IN PLACE
// on this page, not objects with their own detail route. An engagement template
// earns a card because it carries scope, money and documents; a task template
// is a name and a handful of lines.

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Plus, Trash2, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TASK_KIND_META, taskKindLabelKey } from "@/lib/tasks/kinds";
import type { TaskKind } from "@/lib/db/engagement-tasks";
import type { TaskTemplate } from "@/lib/db/task-templates";
import type { TemplateChecklistItem } from "@/lib/engagements/template-payload";
import {
  saveTaskTemplateAction,
  archiveTaskTemplateAction,
} from "@/app/actions/task-templates";

type DraftRow = {
  title: string;
  kind: TaskKind;
  /** The client request this task carries, copied from a request template. */
  checklist: TemplateChecklistItem[];
};

export function TaskTemplateCatalogue({
  templates,
  requestTemplates = [],
  locale,
  openOnMount = false,
}: {
  templates: TaskTemplate[];
  /**
   * The firm's document-request templates — Canopy's "Client request
   * templates". Offered inside a document-collection row so a task template can
   * carry what the client is asked to send.
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
  const [name, setName] = useState("");
  const [access, setAccess] = useState<"team" | "private">("team");
  const [rows, setRows] = useState<DraftRow[]>([{ title: "", kind: "task", checklist: [] }]);
  const [error, setError] = useState<string | null>(null);

  const usableRows = rows.filter((r) => r.title.trim().length > 0);
  const canSave = name.trim().length > 0 && usableRows.length > 0;

  function reset() {
    setName("");
    setAccess("team");
    setRows([{ title: "", kind: "task", checklist: [] }]);
    setError(null);
  }

  function save() {
    if (!canSave) return;
    setError(null);
    startTransition(async () => {
      const res = await saveTaskTemplateAction({
        name: name.trim(),
        access,
        tasks: usableRows.map((r) => ({
          title: r.title.trim(),
          kind: r.kind,
          // Only where it means something. A client request on a "meeting"
          // row is ignored by the reader anyway, but sending it would put
          // noise in the stored payload.
          ...(r.kind === "document_collection" && r.checklist.length > 0
            ? { checklist: r.checklist }
            : {}),
        })),
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

  function archive(id: string) {
    startTransition(async () => {
      const res = await archiveTaskTemplateAction(id);
      if (!res.ok) {
        setError(res.needsMigration ? "needs_migration" : "failed");
        return;
      }
      router.refresh();
    });
  }

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
          <ul className="space-y-2">
            {templates.map((tpl) => (
              <li
                key={tpl.id}
                className="flex items-start gap-3 rounded-xl border border-border/70 bg-card p-3"
              >
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                  <ListChecks className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-foreground">
                      {tpl.name}
                    </p>
                    {tpl.access === "private" && (
                      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        {t("access_private")}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {/* The steps themselves, in order — the whole template is
                        short enough that a count would say less than the list. */}
                    {tpl.payload.tasks.map((x) => x.title).join(" · ")}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => archive(tpl.id)}
                  className="shrink-0 text-muted-foreground transition-colors hover:text-destructive disabled:opacity-40"
                  aria-label={t("remove_a11y", { name: tpl.name })}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
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
        <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("task_templates_name_placeholder")}
            aria-label={t("task_templates_name_placeholder")}
          />

          <div className="flex flex-wrap items-center gap-3 text-xs">
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

          <ul className="space-y-2">
            {rows.map((row, idx) => (
              <li key={idx} className="space-y-2">
                <div className="flex items-center gap-2">
                <Input
                  value={row.title}
                  onChange={(e) =>
                    setRows((prev) =>
                      prev.map((r, i) =>
                        i === idx ? { ...r, title: e.target.value } : r,
                      ),
                    )
                  }
                  placeholder={tEng("task_title_placeholder")}
                  aria-label={tEng("task_title_placeholder")}
                  className="flex-1"
                />
                {/* Every kind is offered here, INCLUDING the one-per-engagement
                    ones. A template is not an engagement — the limit applies
                    when the tasks are actually created, and the builder's own
                    picker enforces it there. */}
                <select
                  value={row.kind}
                  onChange={(e) =>
                    setRows((prev) =>
                      prev.map((r, i) =>
                        i === idx
                          ? { ...r, kind: e.target.value as TaskKind }
                          : r,
                      ),
                    )
                  }
                  aria-label={tEng("task_kind_label")}
                  className="h-9 rounded-md border border-input bg-background px-2 text-xs"
                >
                  {TASK_KIND_META.map((meta) => (
                    <option key={meta.kind} value={meta.kind}>
                      {tEng(taskKindLabelKey(meta.kind) as "kind_task")}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() =>
                    setRows((prev) =>
                      prev.length === 1
                        ? prev
                        : prev.filter((_, i) => i !== idx),
                    )
                  }
                  disabled={rows.length === 1}
                  className="text-muted-foreground transition-colors hover:text-destructive disabled:opacity-30"
                  aria-label={t("remove")}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
                </div>

                {/* ── THE CLIENT REQUEST THIS TASK CARRIES ─────────────────
                    Canopy's "Add client request", which lives INSIDE the task
                    template rather than beside it: their article has you edit
                    the task template and, at the bottom, Add → Add client
                    request, then Apply template to fill it in.

                    Applying COPIES the lines rather than storing a reference.
                    Canopy's own wording is that the fields "will be populated
                    according to the selected template", and this repo's rule is
                    copy-on-use — otherwise a firm tidying up its document
                    requests would silently change what every saved task
                    template asks for. */}
                {row.kind === "document_collection" &&
                  requestTemplates.length > 0 && (
                    <div className="ml-1 flex flex-wrap items-center gap-2 border-l-2 border-border pl-3 text-xs">
                      <span className="text-muted-foreground">
                        {t("task_template_client_request")}
                      </span>
                      <select
                        // Resets after each apply so the same request template
                        // can be applied twice; a select already holding the
                        // value fires no change event.
                        value=""
                        onChange={(e) => {
                          const picked = requestTemplates.find(
                            (x) => x.id === e.target.value,
                          );
                          if (!picked) return;
                          setRows((prev) =>
                            prev.map((r, i) =>
                              i === idx
                                ? { ...r, checklist: [...picked.items] }
                                : r,
                            ),
                          );
                        }}
                        aria-label={t("task_template_apply_request")}
                        className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                      >
                        <option value="">
                          {t("task_template_apply_request")}
                        </option>
                        {requestTemplates.map((rt) => (
                          <option key={rt.id} value={rt.id}>
                            {rt.name}
                          </option>
                        ))}
                      </select>
                      {row.checklist.length > 0 && (
                        <>
                          <span className="text-muted-foreground">
                            {/* The lines themselves, not a count — a template
                                you are building should show what it will ask
                                for. */}
                            {row.checklist
                              .slice(0, 4)
                              .map((c) =>
                                locale === "fr"
                                  ? c.label_fr || c.label_en
                                  : c.label_en || c.label_fr,
                              )
                              .join(" · ")}
                            {row.checklist.length > 4 &&
                              ` +${row.checklist.length - 4}`}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setRows((prev) =>
                                prev.map((r, i) =>
                                  i === idx ? { ...r, checklist: [] } : r,
                                ),
                              )
                            }
                            className="text-muted-foreground underline transition-colors hover:text-destructive"
                          >
                            {t("remove")}
                          </button>
                        </>
                      )}
                    </div>
                  )}
              </li>
            ))}
          </ul>

          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() =>
              setRows((prev) => [...prev, { title: "", kind: "task", checklist: [] }])
            }
          >
            <Plus className="h-3.5 w-3.5" />
            {tEng("add_task")}
          </Button>

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
