"use client";

// "+ Add task" — and the two questions that follow it.
//
// The founder: "it should be empty until the user goes and creates a task, and
// then that'll be prompted like, what kind of task are you trying to create? A
// deliverable... a signature, a document collection?"
//
// So the kind is chosen FIRST, because it decides what the thing IS rather than
// being a property of it. A document collection is not a task that happens to
// collect documents; it is a different object with a different screen, and
// picking it afterwards from a dropdown would imply you could change your mind.
//
// The label is Canopy's own on this screen ("+ Add task"), checked against their
// documentation rather than invented.
//
// ── AND THEN YOU NAME IT. ALWAYS. ──────────────────────────────────────────
//
// The founder: "the tag 'document colletion' is too broad and not an actual
// accouting term... every task should have an ctual name not just a broad
// tagline."
//
// Right, and the first version of this made it worse by PRE-FILLING the name
// with the kind, which meant nobody typed one and twenty-eight rows on the
// firm list all read "Document collection". The kind is now a small tag on the
// row and the name is yours: "2025 T2 supporting documents", "Year-end AP
// confirmations". The field starts EMPTY on every kind, because a pre-filled
// field is a suggestion that it is already answered.
//
// ── A POPOVER, NOT A MODAL ─────────────────────────────────────────────────
//
// Founder: "the add task shouldnt open a front screen ui box it should come
// from a smaller box that opens up near the add task button kinda like a
// dropdown." Which is also right on its own terms — a modal is for a decision
// you must finish before anything else can happen, and adding a task is not
// that. It now opens against the button that summoned it.
//
// ── WHY A KIND CAN BE GREYED OUT RATHER THAN MISSING ───────────────────────
//
// Founder: "why is there only two options for the add task button?" Because the
// first version silently HID the built-in kinds a job already had — so the menu
// quietly shrank and there was no way to find out why. A second document
// collection would drive the same request_items as the first, so the database
// refuses it (1370); but "you already have one" is an answer and an empty space
// is not. They are shown, disabled, with the reason.
//
// ── TWO PLACES, ONE COMPONENT ──────────────────────────────────────────────
//
// A `mode` prop between them — the shape client-team-editor.tsx set as this
// repo's precedent. On a JOB the client and the engagement are both known and
// the question is which kind. On the firm-wide Tasks list neither is known, so
// the question is which CLIENT — and there is no kind question at all, because
// document collections, signatures and deliverables all point at collections
// keyed by engagement_id and cannot exist without a job. Offering them there
// would be offering three doors into a room that has not been built.

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import {
  CheckSquare,
  ChevronLeft,
  FileSignature,
  FolderCheck,
  Inbox,
  Plus,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
      /** Built-in kinds this job already has, so they are offered disabled. */
      existingKinds: string[];
    }
  | {
      /** On the firm-wide Tasks list, where the task belongs to a client only. */
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

  const taken = (k: (typeof KINDS)[number]) =>
    k.once && props.mode !== "firm" && props.existingKinds.includes(k.kind);

  const nameField = (
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
      // An EXAMPLE, not a default. The field is empty on purpose — see the
      // note at the top of this file about twenty-eight identical rows.
      placeholder={t("add_task_name_placeholder")}
      aria-label={t("add_task_name")}
    />
  );

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="secondary">
          <Plus className="size-4" aria-hidden />
          {t("add_task")}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" sideOffset={6} className="w-[320px] p-3">
        <div className="mb-2 flex items-start gap-2">
          {kind && !firmWide && (
            <button
              type="button"
              onClick={reset}
              aria-label={t("add_task_back")}
              className="-ml-1 mt-0.5 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronLeft className="size-4" aria-hidden />
            </button>
          )}
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {firmWide
                ? t("add_task_for_client")
                : kind
                  ? label(kind)
                  : t("add_task_kind")}
            </p>
            <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
              {firmWide
                ? t("add_task_for_client_hint")
                : kind
                  ? hint(kind)
                  : t("add_task_kind_hint")}
            </p>
          </div>
        </div>

        {firmWide ? (
          // One step, not two. Without a job there is no kind to choose, so a
          // "what kind?" screen offering exactly one answer would be a click
          // that asks nothing.
          <div className="flex flex-col gap-2">
            <ClientCombobox
              clients={props.mode === "firm" ? props.clients : []}
              value={clientId}
              onChange={setClientId}
            />
            {nameField}
            <Button
              type="button"
              size="sm"
              onClick={create}
              disabled={!clientId || !title.trim() || busy}
            >
              {t("add_task")}
            </Button>
          </div>
        ) : !kind ? (
          <div className="flex flex-col gap-1">
            {KINDS.map((k) => {
              const used = taken(k);
              return (
                <button
                  key={k.kind}
                  type="button"
                  disabled={used}
                  onClick={() => setKind(k.kind)}
                  className={cn(
                    "flex items-start gap-2.5 rounded-lg p-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    used
                      ? "cursor-not-allowed opacity-55"
                      : "hover:bg-muted/70",
                  )}
                >
                  <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <k.icon className="size-3.5" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium">
                      {label(k.kind)}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                      {/* Say WHY it cannot be picked. A greyed row with no
                          reason is the same dead end as a hidden one. */}
                      {used ? t("add_task_kind_taken") : hint(k.kind)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {nameField}
            <Button
              type="button"
              size="sm"
              onClick={create}
              disabled={!title.trim() || busy}
            >
              {t("add_task")}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
