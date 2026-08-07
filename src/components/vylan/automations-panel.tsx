"use client";

// The automations library — the founder's ask, verbatim: "premake a bunch of
// automations... rename the automation and then select it". This panel is the
// premaking half; picking one happens on a template (chunk 2b).
//
// Built-ins are readable by every firm and editable by none: expanding one
// shows the read-only editor with Clone to customize. A firm's own rows edit
// in place with an explicit Save — the editor is controlled and drafts live
// here, so closing an expanded row without saving discards cleanly.

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Archive, ChevronDown, Copy, Plus, Sparkles, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/cn";
import {
  AutomationEditor,
  type EditorMember,
} from "@/components/workflow/automation-editor";
import {
  archiveAutomationAction,
  cloneAutomationAction,
  createAutomationAction,
  draftAutomationAction,
  updateAutomationAction,
} from "@/app/actions/automations";
import { BUILTIN_AUTOMATION_IDS, type WorkflowDefinition } from "@/lib/workflow/definition";
import { buildWorkflowSummaryLine } from "@/lib/workflow/summary";

export type AutomationRow = {
  id: string;
  firmId: string | null;
  name: string;
  definition: WorkflowDefinition | null;
  usedBy: number;
};

// Built-in names ship in the rows as English; the UI localizes by fixed id,
// the same trick builtin-names.ts plays for templates. Exported: the template
// page's picker names the same rows and must never spell them differently.
export const BUILTIN_NAME_KEYS: Record<string, string> = {
  [BUILTIN_AUTOMATION_IDS.return]: "builtin_return",
  [BUILTIN_AUTOMATION_IDS.gst]: "builtin_gst",
  [BUILTIN_AUTOMATION_IDS.bookkeeping]: "builtin_bookkeeping",
  [BUILTIN_AUTOMATION_IDS.onboarding]: "builtin_onboarding",
};

export function AutomationsPanel({
  automations,
  members,
  aiDraftEnabled = false,
}: {
  automations: AutomationRow[];
  members: EditorMember[];
  /** Server-decided (ANTHROPIC_API_KEY present). Off = the create dialog is
   *  exactly what it was; nothing AI-shaped renders at all. */
  aiDraftEnabled?: boolean;
}) {
  const t = useTranslations("Automations");
  const locale = useLocale() === "fr" ? "fr" : "en";
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  // The expanded row's unsaved edits (firm rows only).
  const [draft, setDraft] = useState<{
    id: string;
    name: string;
    definition: WorkflowDefinition;
  } | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newBase, setNewBase] = useState<string>(
    BUILTIN_AUTOMATION_IDS.return,
  );
  const [cloning, setCloning] = useState<AutomationRow | null>(null);
  const [cloneName, setCloneName] = useState("");
  // The AI draft under review — the propose/approve doctrine as component
  // state: nothing persists until the human clicks Save, and Discard is a
  // state reset. `description` is kept so refinements carry the original ask.
  const [aiDescription, setAiDescription] = useState("");
  const [aiDrafting, setAiDrafting] = useState(false);
  const [aiDraft, setAiDraft] = useState<{
    name: string;
    summary: string;
    definition: WorkflowDefinition;
    description: string;
  } | null>(null);
  const [aiInstruction, setAiInstruction] = useState("");

  function runDraft(opts: { refine: boolean }) {
    const description = opts.refine ? aiDraft!.description : aiDescription.trim();
    // The name the human chose (typed in the dialog, or edited on the card)
    // survives every AI round-trip; only a first draft with no typed name
    // takes the model's suggestion.
    const keptName = opts.refine ? aiDraft!.name : newName.trim();
    setAiDrafting(true);
    startTransition(async () => {
      try {
        const res = await draftAutomationAction({
          description,
          locale,
          ...(opts.refine
            ? {
                current: aiDraft!.definition,
                instruction: aiInstruction.trim(),
              }
            : {}),
        });
        if (!res.ok) {
          toast.error(
            res.error === "not_configured"
              ? t("ai_draft_not_configured")
              : res.error === "rate_limited"
                ? t("ai_draft_rate_limited")
                : t("ai_draft_failed"),
          );
          return;
        }
        // The definition crossed a server boundary as JSON; it is exactly the
        // shape the parser emitted, so the cast is the round-trip, not a guess.
        setAiDraft({
          name: keptName || res.name,
          summary: locale === "fr" ? res.summaryFr : res.summaryEn,
          definition: res.definition as WorkflowDefinition,
          description,
        });
        setAiInstruction("");
        setCreating(false);
      } catch {
        // Network drop / server throw: without this, aiDrafting stays true
        // forever and the whole feature reads as wedged.
        toast.error(t("ai_draft_failed"));
      } finally {
        setAiDrafting(false);
      }
    });
  }

  const displayName = (a: AutomationRow) =>
    a.firmId === null && BUILTIN_NAME_KEYS[a.id]
      ? t(BUILTIN_NAME_KEYS[a.id])
      : a.name;

  function toggleRow(a: AutomationRow) {
    if (openId === a.id) {
      setOpenId(null);
      setDraft(null);
      return;
    }
    setOpenId(a.id);
    setDraft(
      a.firmId !== null && a.definition
        ? { id: a.id, name: a.name, definition: a.definition }
        : null,
    );
  }

  function run(action: () => Promise<{ ok: boolean }>, doneMsg: string) {
    setBusy(true);
    startTransition(async () => {
      const res = await action();
      setBusy(false);
      if (res.ok) {
        toast.success(doneMsg);
      } else {
        toast.error(t("error_save"));
      }
    });
  }

  const summaryLine = (def: WorkflowDefinition | null): string =>
    def ? buildWorkflowSummaryLine(def, t) : "";

  return (
    <section aria-labelledby="automations-lib" className="mb-10">
      <h2
        id="automations-lib"
        className="text-sm font-semibold uppercase tracking-wide text-muted-foreground"
      >
        {t("panel_title")}
      </h2>
      <div className="mb-4 mt-4 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t("panel_intro")}</p>
        <Button
          size="sm"
          onClick={() => {
            setNewName("");
            setNewBase(BUILTIN_AUTOMATION_IDS.return);
            setCreating(true);
          }}
        >
          <Plus className="mr-1.5 size-4" aria-hidden />
          {t("new_automation")}
        </Button>
      </div>

      {/* The AI draft, under review — the same editor every flow uses, an
          explicit Save, and a change-request box for iterating. Nothing here
          exists in the database yet. */}
      {aiDraft && (
        <div className="mb-4 rounded-xl border border-accent/40 bg-accent-subtle/30 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Sparkles className="size-4 shrink-0 text-accent" aria-hidden />
            <span className="text-sm font-medium">{t("ai_draft_title")}</span>
            <span className="text-xs text-muted-foreground">
              {t("ai_draft_review_note")}
            </span>
          </div>
          {aiDraft.summary && (
            <p className="mt-2 text-sm text-muted-foreground">
              {aiDraft.summary}
            </p>
          )}
          <div className="mt-3">
            <Label htmlFor="ai-draft-name">{t("name_label")}</Label>
            <Input
              id="ai-draft-name"
              value={aiDraft.name}
              className="mt-1 max-w-sm"
              onChange={(e) =>
                setAiDraft({ ...aiDraft, name: e.target.value })
              }
            />
          </div>
          <div className="mt-3">
            <AutomationEditor
              value={aiDraft.definition}
              onChange={(definition) =>
                setAiDraft({ ...aiDraft, definition })
              }
              members={members}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Input
              value={aiInstruction}
              placeholder={t("ai_refine_placeholder")}
              maxLength={1000}
              className="max-w-md"
              onChange={(e) => setAiInstruction(e.target.value)}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              // busy too: a refine racing a Save-in-flight would resurrect
              // the card for a flow that just landed in the library.
              disabled={busy || aiDrafting || aiInstruction.trim().length < 3}
              onClick={() => runDraft({ refine: true })}
            >
              {aiDrafting ? t("ai_drafting") : t("ai_refine_button")}
            </Button>
            <div className="ml-auto flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy || aiDrafting}
                onClick={() => setAiDraft(null)}
              >
                {t("ai_discard")}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={
                  busy || aiDrafting || aiDraft.name.trim().length === 0
                }
                onClick={() => {
                  const draftToSave = aiDraft;
                  run(async () => {
                    const res = await createAutomationAction({
                      name: draftToSave.name.trim(),
                      definition: draftToSave.definition,
                    });
                    if (res.ok) setAiDraft(null);
                    return res;
                  }, t("created_toast"));
                }}
              >
                {t("ai_save_to_library")}
              </Button>
            </div>
          </div>
        </div>
      )}

      <ul className="overflow-hidden rounded-xl border border-border">
        {automations.map((a) => {
          const open = openId === a.id;
          const isBuiltin = a.firmId === null;
          const editing = open && draft?.id === a.id;
          const dirty =
            editing &&
            (draft.name !== a.name ||
              JSON.stringify(draft.definition) !==
                JSON.stringify(a.definition));
          return (
            <li key={a.id} className="border-b border-border last:border-b-0">
              <button
                type="button"
                onClick={() => toggleRow(a)}
                aria-expanded={open}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
              >
                <Zap className="size-4 shrink-0 text-accent" aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {displayName(a)}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {summaryLine(a.definition)}
                  </span>
                </span>
                <span className="ml-auto flex shrink-0 items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {t("used_by", { count: a.usedBy })}
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[11px]",
                      isBuiltin
                        ? "border border-border text-muted-foreground"
                        : "bg-accent-subtle text-accent",
                    )}
                  >
                    {isBuiltin ? t("chip_builtin") : t("chip_yours")}
                  </span>
                  <ChevronDown
                    className={cn(
                      "size-4 text-muted-foreground transition-transform",
                      open && "rotate-180",
                    )}
                    aria-hidden
                  />
                </span>
              </button>

              {open && a.definition && (
                <div className="border-t border-border bg-muted/20 p-4">
                  {editing ? (
                    <>
                      <div className="mb-3 flex items-center gap-2">
                        <Label
                          htmlFor={`name-${a.id}`}
                          className="text-xs text-muted-foreground"
                        >
                          {t("name_label")}
                        </Label>
                        <Input
                          id={`name-${a.id}`}
                          value={draft.name}
                          className="h-8 max-w-xs text-sm"
                          onChange={(e) =>
                            setDraft({ ...draft, name: e.target.value })
                          }
                        />
                        <div className="ml-auto flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground"
                            disabled={busy}
                            onClick={() =>
                              run(
                                () => archiveAutomationAction({ id: a.id }),
                                t("archived_toast"),
                              )
                            }
                          >
                            <Archive className="mr-1 size-3.5" aria-hidden />
                            {t("archive")}
                          </Button>
                          <Button
                            size="sm"
                            disabled={busy || !dirty}
                            onClick={() =>
                              run(
                                () =>
                                  updateAutomationAction({
                                    id: a.id,
                                    name: draft.name,
                                    definition: draft.definition,
                                  }),
                                t("saved_toast"),
                              )
                            }
                          >
                            {t("save")}
                          </Button>
                        </div>
                      </div>
                      <AutomationEditor
                        value={draft.definition}
                        onChange={(definition) =>
                          setDraft({ ...draft, definition })
                        }
                        members={members}
                      />
                    </>
                  ) : (
                    <>
                      <div className="mb-3 flex items-center justify-end">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setCloneName(
                              t("clone_default_name", {
                                name: displayName(a),
                              }),
                            );
                            setCloning(a);
                          }}
                        >
                          <Copy className="mr-1.5 size-3.5" aria-hidden />
                          {t("clone_to_customize")}
                        </Button>
                      </div>
                      <AutomationEditor
                        value={a.definition}
                        onChange={() => {}}
                        members={members}
                        disabled
                      />
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {/* New automation */}
      <Dialog open={creating} onOpenChange={(o) => !o && setCreating(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("new_automation")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div>
              <Label htmlFor="new-name">{t("name_label")}</Label>
              <Input
                id="new-name"
                value={newName}
                autoFocus
                placeholder={t("name_placeholder")}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div>
              <Label>{t("start_from")}</Label>
              <Select value={newBase} onValueChange={setNewBase}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {automations.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {displayName(a)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Or describe it — the AI drafts, YOU review and save. Renders
                only when the server said drafting is available. */}
            {aiDraftEnabled && (
              <div className="border-t border-border/60 pt-3">
                <Label htmlFor="ai-describe" className="flex items-center gap-1.5">
                  <Sparkles className="size-3.5 text-accent" aria-hidden />
                  {t("ai_draft_label")}
                </Label>
                <Textarea
                  id="ai-describe"
                  value={aiDescription}
                  rows={3}
                  maxLength={2000}
                  placeholder={t("ai_draft_placeholder")}
                  onChange={(e) => setAiDescription(e.target.value)}
                  className="mt-1.5"
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    {t("ai_draft_hint")}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={aiDrafting || aiDescription.trim().length < 10}
                    onClick={() => runDraft({ refine: false })}
                  >
                    {aiDrafting ? t("ai_drafting") : t("ai_draft_button")}
                  </Button>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setCreating(false)}
              disabled={busy}
            >
              {t("cancel")}
            </Button>
            <Button
              disabled={busy || newName.trim().length === 0}
              onClick={() => {
                setCreating(false);
                run(
                  () =>
                    createAutomationAction({
                      name: newName.trim(),
                      baseId: newBase,
                    }),
                  t("created_toast"),
                );
              }}
            >
              {t("create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Clone a built-in (or any row) */}
      <Dialog open={cloning !== null} onOpenChange={(o) => !o && setCloning(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("clone_to_customize")}</DialogTitle>
          </DialogHeader>
          <div>
            <Label htmlFor="clone-name">{t("name_label")}</Label>
            <Input
              id="clone-name"
              value={cloneName}
              autoFocus
              onChange={(e) => setCloneName(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setCloning(null)}
              disabled={busy}
            >
              {t("cancel")}
            </Button>
            <Button
              disabled={busy || cloneName.trim().length === 0}
              onClick={() => {
                const source = cloning;
                setCloning(null);
                if (!source) return;
                run(
                  () =>
                    cloneAutomationAction({
                      id: source.id,
                      name: cloneName.trim(),
                    }),
                  t("created_toast"),
                );
              }}
            >
              {t("create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
