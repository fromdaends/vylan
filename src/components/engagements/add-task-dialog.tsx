"use client";

// "+ Add task" — and the question that follows it.
//
// The founder: "it should be empty until the user goes and creates a task, and
// then that'll be prompted like, what kind of task are you trying to create? A
// deliverable... a signature, a document collection?"
//
// So the kind is chosen FIRST, because it decides what the thing is rather than
// being a property of it. A document collection is not a task that happens to
// collect documents; it is a different object with a different screen, and
// picking it afterwards from a dropdown would imply you could change your mind.
//
// The label is Canopy's own on this screen ("+ Add task"), checked against
// their documentation rather than invented.
//
// ONE OF EACH BUILT-IN KIND PER JOB. A second document collection would drive
// the same request_items as the first, so its row would be a duplicate of the
// one above it. The database enforces this (1370); the dialog just stops
// offering the kinds you already have, because a menu option that always
// errors is worse than no option.
//
// TWO PLACES, ONE COMPONENT, a `mode` prop between them — the shape
// client-team-editor.tsx set as this repo's precedent. On a JOB the client and
// the engagement are both already known and the question is which kind. On the
// firm-wide Work list neither is known, so the question is which CLIENT — and
// there is no kind question at all, because document collections, signatures
// and deliverables all point at collections keyed by engagement_id and
// therefore cannot exist without a job. Offering them there would be offering
// three doors into a room that has not been built.

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { CheckSquare, FileSignature, FolderCheck, Inbox, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ClientCombobox,
  type ComboboxClient,
} from "@/components/clients/client-combobox";
import { addTaskAction } from "@/app/actions/engagement-tasks";

type Kind = "document_collection" | "signatures" | "deliverables" | "task";

const KINDS: { kind: Kind; icon: typeof Inbox; once: boolean }[] = [
  { kind: "document_collection", icon: Inbox, once: true },
  { kind: "signatures", icon: FileSignature, once: true },
  { kind: "deliverables", icon: FolderCheck, once: true },
  { kind: "task", icon: CheckSquare, once: false },
];

type AddTaskDialogProps =
  | {
      /** On a job. The default, and what every existing caller passes. */
      mode?: "job";
      clientId: string;
      engagementId: string;
      /** Built-in kinds this job already has, so they stop being offered. */
      existingKinds: string[];
    }
  | {
      /** On the firm-wide Work list, where the task belongs to a client only. */
      mode: "firm";
      clients: ComboboxClient[];
    };

export function AddTaskDialog(props: AddTaskDialogProps) {
  const firmWide = props.mode === "firm";
  const t = useTranslations("Engagements");
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  // Null while choosing a kind; set once chosen, which is when the name field
  // appears. Two steps, not one form — the kind changes what the name means.
  const [kind, setKind] = useState<Kind | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  // Firm-wide only: which client this is for. There is no sensible default —
  // guessing one is how a task ends up filed against the wrong person.
  const [clientId, setClientId] = useState<string | null>(null);

  const label = (k: Kind) =>
    k === "document_collection"
      ? t("kind_document_collection")
      : k === "signatures"
        ? t("kind_signatures")
        : k === "deliverables"
          ? t("kind_deliverables")
          : t("kind_task");

  const hint = (k: Kind) =>
    k === "document_collection"
      ? t("kind_document_collection_hint")
      : k === "signatures"
        ? t("kind_signatures_hint")
        : k === "deliverables"
          ? t("kind_deliverables_hint")
          : t("kind_task_hint");

  function reset() {
    setKind(null);
    setTitle("");
    setClientId(null);
  }

  function choose(k: Kind) {
    setKind(k);
    // The built-in kinds have an obvious name and nobody wants to type it, so
    // it is filled in and stays editable.
    setTitle(k === "task" ? "" : label(k));
  }

  async function create() {
    const forClient = firmWide ? clientId : props.clientId;
    // On a job the kind has been chosen by now; on the firm list it can only
    // ever be the plain one.
    const forKind: Kind | null = firmWide ? "task" : kind;
    if (!forClient || !forKind || !title.trim() || busy) return;
    setBusy(true);
    try {
      const res = await addTaskAction({
        clientId: forClient,
        // Explicitly null rather than omitted: this task belongs to the client
        // and to no job, which is the whole point of the firm-wide list.
        engagementId: firmWide ? null : props.engagementId,
        title: title.trim(),
        kind: forKind,
      });
      if (res.ok) {
        setOpen(false);
        reset();
        startTransition(() => router.refresh());
      } else {
        toast.error(
          res.needsMigration
            ? t("work_needs_migration")
            : res.error === "bad_title"
              ? t("work_bad_title")
              : t("work_failed"),
        );
      }
    } finally {
      setBusy(false);
    }
  }

  const available = KINDS.filter(
    (k) =>
      !k.once || (props.mode !== "firm" && !props.existingKinds.includes(k.kind)),
  );

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        <Plus className="size-4" aria-hidden />
        {t("add_task")}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) reset();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {firmWide
                ? t("add_task_for_client")
                : kind
                  ? t("add_task_name")
                  : t("add_task_kind")}
            </DialogTitle>
            <DialogDescription>
              {firmWide
                ? t("add_task_for_client_hint")
                : kind
                  ? hint(kind)
                  : t("add_task_kind_hint")}
            </DialogDescription>
          </DialogHeader>

          {firmWide ? (
            // One step, not two. Without a job there is no kind to choose, so a
            // "what kind?" screen offering exactly one answer would be a click
            // that asks nothing.
            <div className="flex flex-col gap-3">
              <ClientCombobox
                clients={props.mode === "firm" ? props.clients : []}
                value={clientId}
                onChange={setClientId}
              />
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    create();
                  }
                }}
                placeholder={t("work_add_placeholder")}
                aria-label={t("add_task_name")}
              />
              <div className="flex justify-end">
                <Button
                  type="button"
                  onClick={create}
                  disabled={!clientId || !title.trim() || busy}
                >
                  {t("add_task")}
                </Button>
              </div>
            </div>
          ) : !kind ? (
            <div className="flex flex-col gap-1">
              {available.map(({ kind: k, icon: Icon }) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => choose(k)}
                  className="flex items-start gap-3 rounded-lg border border-border/60 p-3 text-left transition-colors hover:border-foreground/25 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{label(k)}</span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                      {hint(k)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <Input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    create();
                  }
                }}
                placeholder={label(kind)}
                aria-label={t("add_task_name")}
              />
              <div className="flex items-center justify-between gap-2">
                <Button type="button" variant="ghost" onClick={reset}>
                  {t("add_task_back")}
                </Button>
                <Button
                  type="button"
                  onClick={create}
                  disabled={!title.trim() || busy}
                >
                  {t("add_task")}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
