"use client";

// "+ Add task" — ONE flow, wherever you press it.
//
// The founder: "now theres 2 kinds of ways of adding tasks. One on the tasks
// screen and one on an open engagement. The function of adding a task on
// engagement should be implemented to like the asking what kind of task. MERGE
// THE TWO VERSIONS AND ADD WHAT I ASKED FOR TOO."
//
// They were two flows because I let the CONTEXT decide the questions: on a job
// the client and engagement were known so it asked the kind, and on the Tasks
// page neither was known so it asked the client and skipped the kind entirely.
// That is backwards. The kind is the first question in both places, because it
// decides what the thing IS; what changes between the two screens is only which
// answers are already filled in.
//
//   Step 1  What kind?     — always, both screens.
//   Step 2  The details    — name, WHO it is for, WHEN it is due, WHO does it,
//                            and how much it matters.
//
// A kind that owns a collection needs a job to hang off, so choosing one on the
// Tasks page asks for the engagement too. That is the merge: not "the same
// component twice", but the same questions with different blanks pre-filled.
//
// ── EVERYTHING IS ASKED UP FRONT ───────────────────────────────────────────
//
// The founder: "creating a task should ask for a due date and whatever relevant
// information. Not only after." Right — a create form that captures a name and
// nothing else is how a board fills with unowned, undated rows, which is the
// exact state the Tasks screen exists to make visible. Only the name is
// REQUIRED; the rest are offered, because forcing an owner at creation is how
// every task ends up assigned to whoever made it.
//
// ── A POPOVER, NOT A MODAL ─────────────────────────────────────────────────
//
// "the add task shouldnt open a front screen ui box it should come from a
// smaller box that opens up near the add task button kinda like a dropdown."
//
// ── WHY A KIND CAN BE GREYED OUT RATHER THAN MISSING ───────────────────────
//
// "why is there only two options for the add task button?" Because the first
// version silently HID the built-in kinds a job already had. A second document
// collection would drive the same request_items as the first, so the database
// refuses it (1370) — but "you already have one" is an answer and an empty
// space is not.

import {
  useId,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import {
  Check,
  ChevronLeft,
  Plus,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ClientCombobox,
  type ComboboxClient,
} from "@/components/clients/client-combobox";
import { type TaskKind } from "@/lib/db/engagement-tasks";
import { addTaskAction } from "@/app/actions/engagement-tasks";
import {
  TASK_KIND_META,
  taskKindHasScreen,
  taskKindHintKey,
  taskKindLabelKey,
} from "@/lib/tasks/kinds";
import { TaskKindIcon } from "@/components/engagements/task-kind-icon";

type Kind = TaskKind;
type Priority = "none" | "low" | "medium" | "high";

/** Every kind, in order, from the one place that defines them. The three with
 *  a screen own a collection keyed by engagement_id, so they need a job and a
 *  job may only have one of each; the rest are ordinary tasks with a name. */
const KINDS = TASK_KIND_META;

const PRIORITIES: Priority[] = ["none", "low", "medium", "high"];

export type AddTaskEngagement = {
  id: string;
  clientId: string;
  title: string;
  /** Built-in kinds this job already has, so they are offered disabled. */
  existingKinds: string[];
};

export function AddTaskDialog({
  clientId: fixedClientId,
  engagementId: fixedEngagementId,
  existingKinds = [],
  clients = [],
  engagements = [],
  members = [],
  trigger,
  initialTitle,
  open: controlledOpen,
  onOpenChange,
  onCreated,
}: {
  /** Fixed on a job's page; absent on the firm-wide Tasks page. */
  clientId?: string;
  engagementId?: string;
  /** Only meaningful when engagementId is fixed. */
  existingKinds?: string[];
  /** Needed only where the client is not already known. */
  clients?: ComboboxClient[];
  /** Every open job, so a collection kind can be attached from the Tasks page. */
  engagements?: AddTaskEngagement[];
  members?: { id: string; name: string }[];
  /** Replaces the default "+ Add task" button as the popover's anchor — the
   *  dashboard's quick-add opens this same popover from its own footer rather
   *  than growing a second add-task UI. */
  trigger?: ReactNode;
  /** Seeds the name field on open — what the quick-add row already typed. */
  initialTitle?: string;
  /** Controlled-open pair, for a caller whose trigger lives outside. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Called after a task is actually created — the quick-add clears itself. */
  onCreated?: () => void;
}) {
  const t = useTranslations("Engagements");
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [openSelf, setOpenSelf] = useState(false);
  // Controlled when the caller owns the trigger (the dashboard quick-add),
  // self-managed everywhere else.
  const open = controlledOpen ?? openSelf;
  const setOpen = (o: boolean) => {
    setOpenSelf(o);
    onOpenChange?.(o);
  };
  // Tracks what initialTitle was last seeded, so each fresh open re-seeds.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind | null>(null);
  const [title, setTitle] = useState("");
  const [clientId, setClientId] = useState<string | null>(null);
  const [engagementId, setEngagementId] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState<Priority>("none");
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  // Every field's label is tied to its control by id. A <Label> floating next
  // to an <input> looks identical and is worth nothing to a screen reader —
  // and the test that could not find the due-date field by its label is the
  // same bug seen from the outside.
  const uid = useId();

  // Seed the quick-add's typed title on each open (render-time, not an
  // effect, so the field is right on the first paint of the popover).
  if (open && initialTitle !== undefined && seededFor !== initialTitle) {
    setTitle(initialTitle);
    setSeededFor(initialTitle);
  }

  const clientKnown = Boolean(fixedClientId);
  const jobKnown = Boolean(fixedEngagementId);
  const effectiveClientId = fixedClientId ?? clientId;
  const effectiveEngagementId = fixedEngagementId ?? engagementId;

  const label = (k: Kind) => t(taskKindLabelKey(k) as "kind_task");
  const hint = (k: Kind) => t(taskKindHintKey(k) as "kind_task_hint");

  // Which jobs a collection kind could attach to. Narrowed to the chosen client
  // first, then to the ones that do not already have this kind — the database
  // refuses a duplicate, and an option that always errors is worse than none.
  const jobOptions = useMemo(() => {
    if (!kind || !taskKindHasScreen(kind) || !effectiveClientId) return [];
    return engagements.filter(
      (e) => e.clientId === effectiveClientId && !e.existingKinds.includes(kind),
    );
  }, [kind, effectiveClientId, engagements]);

  // A collection kind chosen away from a job needs one picked.
  // Only a kind that OWNS a collection needs a job. A labelled task —
  // Notice, Meeting, Review — belongs to a client and may have no job at all.
  const needsJob = Boolean(kind && taskKindHasScreen(kind) && !jobKnown);

  function reset() {
    setKind(null);
    setTitle("");
    setClientId(null);
    setEngagementId(null);
    setDueDate("");
    setPriority("none");
    setAssigneeIds([]);
    setSeededFor(null);
  }

  const ready =
    Boolean(kind) &&
    Boolean(title.trim()) &&
    Boolean(effectiveClientId) &&
    (!needsJob || Boolean(engagementId)) &&
    !busy;

  async function create() {
    if (!ready || !kind || !effectiveClientId) return;
    setBusy(true);
    try {
      const res = await addTaskAction({
        clientId: effectiveClientId,
        // Explicitly null for a task that belongs to the client and no job —
        // a missing key reads like an oversight, and this is the point.
        engagementId: effectiveEngagementId ?? null,
        title: title.trim(),
        kind,
        dueDate: dueDate || null,
        priority,
        assigneeIds,
      });
      if (res.ok) {
        setOpen(false);
        reset();
        onCreated?.();
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
    k.hasScreen && jobKnown && existingKinds.includes(k.kind);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <PopoverTrigger asChild>
        {trigger ?? (
          <Button type="button" size="sm" variant="secondary">
            <Plus className="size-4" aria-hidden />
            {t("add_task")}
          </Button>
        )}
      </PopoverTrigger>

      <PopoverContent align="end" sideOffset={6} className="w-[340px] p-3">
        <div className="mb-2 flex items-start gap-2">
          {kind && (
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
              {kind ? label(kind) : t("add_task_kind")}
            </p>
            <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
              {kind ? hint(kind) : t("add_task_kind_hint")}
            </p>
          </div>
        </div>

        {!kind ? (
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
                    used ? "cursor-not-allowed opacity-55" : "hover:bg-muted/70",
                  )}
                >
                  <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <TaskKindIcon kind={k.kind} className="size-3.5" />
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
          <div className="flex max-h-[60vh] flex-col gap-2.5 overflow-y-auto">
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
              // An EXAMPLE, never a default. Pre-filling this with the kind is
              // what left twenty-eight rows all reading "Document collection".
              placeholder={t("add_task_name_placeholder")}
              aria-label={t("add_task_name")}
            />

            {!clientKnown && (
              <Row label={t("col_client")} htmlFor={`${uid}-client`}>
                <ClientCombobox
                  id={`${uid}-client`}
                  clients={clients}
                  value={clientId}
                  onChange={(id) => {
                    setClientId(id);
                    // The job list is per client, so a job chosen under the old
                    // one is no longer a valid answer.
                    setEngagementId(null);
                  }}
                />
              </Row>
            )}

            {needsJob && (
              <Row label={t("col_engagement")} htmlFor={`${uid}-job`}>
                <Select
                  value={engagementId ?? ""}
                  onValueChange={setEngagementId}
                  disabled={!effectiveClientId || jobOptions.length === 0}
                >
                  <SelectTrigger id={`${uid}-job`} className="w-full">
                    <SelectValue
                      placeholder={
                        !effectiveClientId
                          ? t("add_task_pick_client_first")
                          : jobOptions.length === 0
                            ? t("add_task_no_jobs")
                            : t("add_task_pick_job")
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {jobOptions.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Row>
            )}

            <div className="grid grid-cols-2 gap-2">
              <Row label={t("task_due")} htmlFor={`${uid}-due`}>
                <Input
                  id={`${uid}-due`}
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </Row>
              <Row label={t("col_priority")} htmlFor={`${uid}-priority`}>
                <Select
                  value={priority}
                  onValueChange={(v) => setPriority(v as Priority)}
                >
                  <SelectTrigger id={`${uid}-priority`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p}>
                        {t(`priority_${p}` as "priority_none")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Row>
            </div>

            {members.length > 0 && (
              <fieldset className="flex min-w-0 flex-col gap-1">
                <legend className="mb-1 text-[11px] font-medium text-muted-foreground">
                  {t("task_assignees")}
                </legend>
                <div className="flex flex-wrap gap-1">
                  {members.map((m) => {
                    const on = assigneeIds.includes(m.id);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() =>
                          setAssigneeIds((cur) =>
                            on ? cur.filter((x) => x !== m.id) : [...cur, m.id],
                          )
                        }
                        aria-pressed={on}
                        className={cn(
                          "flex items-center gap-1 rounded-full border py-0.5 pl-0.5 pr-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          on
                            ? "border-foreground bg-secondary text-foreground"
                            : "border-border text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <AvatarInitials name={m.name} size={16} />
                        <span className="max-w-[92px] truncate">{m.name}</span>
                        {on && <Check className="size-3 shrink-0" aria-hidden />}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            )}

            <Button
              type="button"
              size="sm"
              onClick={create}
              disabled={!ready}
              className="mt-0.5"
            >
              {t("add_task")}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function Row({
  label,
  htmlFor,
  children,
}: {
  label: string;
  /** REQUIRED, and the control below must carry the same id. A label that is
   *  merely adjacent to its input is decoration. */
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Label
        htmlFor={htmlFor}
        className="text-[11px] font-medium text-muted-foreground"
      >
        {label}
      </Label>
      {children}
    </div>
  );
}
