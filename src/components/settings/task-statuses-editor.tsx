"use client";

// Naming the firm's task statuses.
//
// The founder: "We need more kinds of statuses, for example, canopy has all
// kinds of different ones for ultra specific situations, especially because we
// intend to implement AI workflow automation into the tasks."
//
// Researched before building, on their instruction, and it reversed the obvious
// plan: Canopy's own help centre carries an "Add custom status" button. Their
// answer to "more statuses" is not a longer built-in list, it is statuses the
// firm writes. So this is a list you edit, not six more values I picked.
//
// ── THE BUCKET IS THE PART THAT MATTERS ────────────────────────────────────
//
// Every status says which of three real states it means: not started, under
// way, finished. That is what progress bars, the Active-work view and the
// completion rules read — never the name. It is how Linear and Jira do it, and
// for the same reason: unlimited NAMES are a UI problem, unlimited STATES are a
// logic problem, and only one of those is worth having.
//
// So the bucket picker is not a detail hidden in an "advanced" fold. It is the
// second field, with a line saying what it decides, because a firm that files
// "With client" under finished will get progress bars they do not believe.
//
// ── DELETING ───────────────────────────────────────────────────────────────
//
// You must say where the tasks go. A status that simply vanished would leave
// its rows falling back to a default label, which reads as those tasks quietly
// reclassifying themselves. And the last status in a bucket cannot go at all —
// a bucket with none is a state nothing could ever be set to.

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { Check, ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createStatusAction,
  updateStatusAction,
  deleteStatusAction,
  moveStatusAction,
  type StatusActionResult,
} from "@/app/actions/task-statuses";
import { formatDate, type AppLocale } from "@/lib/format";

type Bucket = "todo" | "doing" | "done";
export type EditableStatus = {
  id: string;
  name: string;
  color: string;
  bucket: Bucket;
  /** One line saying what this status MEANS (1590). */
  description?: string | null;
  /** One of the three every firm starts with — badged "Preset" so the product
   *  does not pass its own defaults off as the firm's work. Everything about a
   *  preset is still editable; the badge says where it CAME FROM. */
  isBuiltin?: boolean;
  /** Who added it and when. Canopy shows the same on custom statuses; a preset
   *  carries its badge instead, because nobody in the firm made it. */
  createdByName?: string | null;
  createdAt?: string | null;
};

const BUCKETS: Bucket[] = ["todo", "doing", "done"];

// Mirrors the server's ceiling (actions/task-statuses). Enforced here only so
// the field stops accepting characters it would silently drop on save.
const DESCRIPTION_MAX = 160;

// Enough range to tell a dozen statuses apart at a glance, and every one of
// them legible as a dot on a row. Free-typed hex is accepted by the server;
// these are just the ones offered.
const SWATCHES = [
  "#64748b",
  "#2563eb",
  "#16a34a",
  "#d97706",
  "#dc2626",
  "#7c3aed",
  "#0891b2",
  "#db2777",
];

export function TaskStatusesEditor({
  statuses,
  canEdit,
  locale = "en",
}: {
  statuses: EditableStatus[];
  /** Owner only. Everyone else reads the list — every task row renders one. */
  canEdit: boolean;
  locale?: AppLocale;
}) {
  const t = useTranslations("Settings");
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  // ── WHY THIS LIST IS LOCAL STATE AND NOT JUST THE PROP ────────────────────
  //
  // The founder: "its fully bugged". It was not. Every write SUCCEEDED — the
  // colour they picked was in the database the whole time. Nothing on screen
  // ever moved, because the only thing that redrew the list was
  // router.refresh() bringing new props back from the server. So you click a
  // colour, the page sits there, you click another, it sits there, and you
  // conclude the page is dead. It took a manual reload to see any of it.
  //
  // An editor must show your own change the instant it is accepted. The server
  // stays the source of truth — the refresh below still runs and reconciles —
  // but the screen no longer waits on a round trip to admit what you just did.
  const [rows, setRows] = useState<EditableStatus[]>(statuses);

  // Re-seed when the server sends a genuinely different list (the refresh
  // landing, or another owner editing in a second tab). Compared by VALUE, not
  // identity: a Server Component hands its client children a new array on every
  // payload, and an identity check here would throw away the optimistic row a
  // moment after showing it — reintroducing the exact bug.
  //
  // Done DURING RENDER, not in an effect. React documents this as the way to
  // adjust state when a prop changes, and it is the correct one here: an effect
  // would paint the stale list first and then correct it, and it trips
  // react-hooks/set-state-in-effect because that cascade is exactly what the
  // rule exists to stop.
  const seed = statuses
    .map((s) => `${s.id}:${s.name}:${s.color}:${s.bucket}`)
    .join("|");
  const [prevSeed, setPrevSeed] = useState(seed);
  if (seed !== prevSeed) {
    setPrevSeed(seed);
    setRows(statuses);
  }
  const [adding, setAdding] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftColor, setDraftColor] = useState(SWATCHES[0]);
  const [draftBucket, setDraftBucket] = useState<Bucket>("todo");
  const [draftDescription, setDraftDescription] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  /**
   * Report an action's outcome, and decide whether the server list is worth
   * re-reading.
   *
   * ⚠️ A REFRESH PER KEYSTROKE WAS HALF THE LATENCY. Every accepted write used
   * to call router.refresh(), which re-renders this Server Component route —
   * three database reads — and hands the client a whole new array. Typing a
   * seven-letter status name fired seven of them, each one racing the next and
   * each one re-seeding the list underneath the cursor.
   *
   * `structural` says the change moved something the client cannot work out for
   * itself: a new row, a deletion, a reorder. Renames, recolours and
   * descriptions are all patched locally and correctly, so re-reading the
   * server tells nobody anything.
   */
  function report(res: StatusActionResult, structural = false): boolean {
    if (res.ok) {
      if (structural) startTransition(() => router.refresh());
      return true;
    }
    toast.error(
      res.error === "at_edge"
        ? t("statuses_at_edge")
        : res.error === "duplicate"
        ? t("statuses_duplicate")
        : res.error === "bad_name"
          ? t("statuses_bad_name")
          : res.error === "last_in_bucket"
            ? t("statuses_last_in_bucket")
            : res.error === "not_allowed"
              ? t("statuses_not_allowed")
              : t("statuses_failed"),
    );
    return false;
  }

  async function add() {
    if (!draftName.trim() || busy) return;
    setBusy(true);
    try {
      const res = await createStatusAction({
        name: draftName.trim(),
        color: draftColor,
        bucket: draftBucket,
        description: draftDescription.trim(),
      });
      if (report(res)) {
        if (res.created) setRows((prev) => [...prev, res.created!]);
        setDraftName("");
        setDraftDescription("");
        setAdding(false);
      }
    } finally {
      setBusy(false);
    }
  }

  const inBucket = (b: Bucket) => rows.filter((s) => s.bucket === b);

  // Applied the moment the server says yes, so the row redraws under your
  // cursor instead of after a refresh you cannot see.
  const patchRow = (id: string, patch: Partial<EditableStatus>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeRow = (id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
    // Deleting DOES move every task off this status, so this one re-reads —
    // it is the only edit on the page whose effects reach past this list.
    startTransition(() => router.refresh());
  };

  // Reorder optimistically for the same reason everything else here is
  // optimistic: a list that only moves after a refresh reads as a list that
  // does not move. Swaps inside the bucket, matching the server.
  async function move(id: string, direction: "up" | "down") {
    const row = rows.find((r) => r.id === id);
    if (!row || busy) return;
    const siblings = rows.filter((r) => r.bucket === row.bucket);
    const i = siblings.findIndex((r) => r.id === id);
    const j = direction === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= siblings.length) return;

    const before = rows;
    const swapped = [...siblings];
    [swapped[i], swapped[j]] = [swapped[j], swapped[i]];
    setRows((prev) => [
      ...prev.filter((r) => r.bucket !== row.bucket),
      ...swapped,
    ]);
    setBusy(true);
    try {
      // Put it back if the server refuses — an order that silently disagrees
      // with the database is worse than one that visibly snaps back.
      if (!report(await moveStatusAction({ id, direction }), true)) setRows(before);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {BUCKETS.map((bucket) => (
        <section key={bucket} className="flex flex-col gap-1.5">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t(`statuses_bucket_${bucket}` as "statuses_bucket_todo")}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t(`statuses_bucket_${bucket}_hint` as "statuses_bucket_todo_hint")}
          </p>
          <ul className="mt-1 flex flex-col divide-y divide-border/60 rounded-lg border border-border">
            {inBucket(bucket).length === 0 && (
              <li className="px-3 py-3 text-sm text-muted-foreground">
                {t("statuses_bucket_empty")}
              </li>
            )}
            {inBucket(bucket).map((status) => (
              <StatusRow
                key={status.id}
                status={status}
                statuses={rows}
                // A bucket with one status left cannot lose it — the server
                // refuses, and the UI must say so BEFORE you pick a
                // replacement rather than after.
                lastInBucket={inBucket(bucket).length <= 1}
                onPatched={patchRow}
                onRemoved={removeRow}
                onMove={move}
                canMoveUp={inBucket(bucket)[0]?.id !== status.id}
                canMoveDown={
                  inBucket(bucket)[inBucket(bucket).length - 1]?.id !== status.id
                }
                locale={locale}
                canEdit={canEdit && !busy}
                confirming={confirmDelete === status.id}
                onConfirm={() =>
                  setConfirmDelete((c) => (c === status.id ? null : status.id))
                }
                onSaved={report}
                t={t}
              />
            ))}
          </ul>
        </section>
      ))}

      {canEdit &&
        (adding ? (
          <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="new-status-name" className="text-xs">
                {t("statuses_name")}
              </Label>
              <Input
                id="new-status-name"
                autoFocus
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    add();
                  }
                }}
                placeholder={t("statuses_name_placeholder")}
              />
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="new-status-bucket" className="text-xs">
                {t("statuses_bucket")}
              </Label>
              <Select
                value={draftBucket}
                onValueChange={(v) => setDraftBucket(v as Bucket)}
              >
                <SelectTrigger id="new-status-bucket" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BUCKETS.map((b) => (
                    <SelectItem key={b} value={b}>
                      {t(`statuses_bucket_${b}` as "statuses_bucket_todo")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* Said out loud, because a firm that files "With client" under
                  finished will get progress bars it does not believe. */}
              <p className="text-xs text-muted-foreground">
                {t("statuses_bucket_explains")}
              </p>
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="new-status-description" className="text-xs">
                {t("statuses_description")}
              </Label>
              <Input
                id="new-status-description"
                value={draftDescription}
                maxLength={DESCRIPTION_MAX}
                onChange={(e) => setDraftDescription(e.target.value)}
                placeholder={t("statuses_description_placeholder")}
              />
              {/* The ambiguity this exists to settle, named outright. */}
              <p className="text-xs text-muted-foreground">
                {t("statuses_description_hint")}
              </p>
            </div>

            <ColorPicker value={draftColor} onChange={setDraftColor} t={t} />

            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setAdding(false)}
              >
                {t("statuses_cancel")}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={add}
                disabled={!draftName.trim() || busy}
              >
                {t("statuses_add")}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="w-fit"
            onClick={() => setAdding(true)}
          >
            <Plus className="size-4" aria-hidden />
            {t("statuses_add")}
          </Button>
        ))}
    </div>
  );
}

function StatusRow({
  status,
  statuses,
  canEdit,
  lastInBucket,
  confirming,
  onConfirm,
  onSaved,
  onPatched,
  onRemoved,
  onMove,
  canMoveUp,
  canMoveDown,
  locale,
  t,
}: {
  status: EditableStatus;
  statuses: EditableStatus[];
  canEdit: boolean;
  /** The only status left in its stage. The server refuses to delete it (a
   *  stage with none is a state nothing could ever be set to), so the bin is
   *  disabled and says why — rather than letting you choose where the tasks go
   *  and only then refusing, which is what it used to do. */
  lastInBucket: boolean;
  confirming: boolean;
  onConfirm: () => void;
  onSaved: (res: StatusActionResult) => boolean;
  onPatched: (id: string, patch: Partial<EditableStatus>) => void;
  onRemoved: (id: string) => void;
  onMove: (id: string, direction: "up" | "down") => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  locale: AppLocale;
  t: ReturnType<typeof useTranslations<"Settings">>;
}) {
  const [name, setName] = useState(status.name);
  const [description, setDescription] = useState(status.description ?? "");
  // "saving" / "saved" instead of a disabled row. See save() for why.
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  // What the server last accepted, so a commit fires only on a real change and
  // a failure knows what to roll back to.
  const committed = useRef({
    name: status.name,
    color: status.color,
    description: status.description ?? "",
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Delete keeps a disable, and ONLY delete: it moves every task off this
  // status, so a double-click is a second migration. Everything else on this
  // row is reversible and instant.
  const [deleting, setDeleting] = useState(false);
  // Where its tasks go. Anything in the firm except this one — including
  // another bucket, which is a real choice: "this stage turned out to be done".
  const [replacement, setReplacement] = useState(
    statuses.find((s) => s.id !== status.id)?.id ?? "",
  );

  /**
   * Commit a change — SCREEN FIRST, SERVER SECOND.
   *
   * The founder, on the version this replaces: "There was still a lot of
   * latency on the statuses page. Like, bro, come on. It should be seamless."
   * They were right, and it was never slow code. It was this function awaiting
   * the round trip BEFORE touching the screen, with setBusy(true) disabling the
   * whole row while it waited. So picking a colour meant: row greys out, wait
   * for the network, dot finally moves, then a full router.refresh() re-renders
   * the page from the server. Three visible delays for one click.
   *
   * Now the patch lands immediately and the write goes out behind it. A failure
   * rolls the row back and says so — which is the only moment anybody should
   * ever wait, and it is the moment that almost never happens.
   *
   * The same shape the roles workbench already uses ("I shouldn't have to click
   * save because people are gonna not do that"), so the two editors in this app
   * that let you name-and-colour a thing now behave identically.
   */
  function save(patch: {
    name?: string;
    color?: string;
    description?: string | null;
  }) {
    // Nothing actually changed — a blur on an untouched field, a re-click of
    // the colour already chosen.
    const unchanged =
      (patch.name === undefined || patch.name === committed.current.name) &&
      (patch.color === undefined || patch.color === committed.current.color) &&
      (patch.description === undefined ||
        (patch.description ?? "") === committed.current.description);
    if (unchanged) return;

    const rollback = { ...committed.current };
    committed.current = {
      name: patch.name ?? committed.current.name,
      color: patch.color ?? committed.current.color,
      description: patch.description ?? committed.current.description,
    };
    // The list redraws NOW. Everything below this line is bookkeeping.
    onPatched(status.id, patch);
    setState("saving");

    void updateStatusAction({ id: status.id, ...patch }).then((res) => {
      if (onSaved(res)) {
        setState("saved");
        return;
      }
      // Put it back exactly as it was, in the row AND in the list.
      committed.current = rollback;
      setName(rollback.name);
      setDescription(rollback.description);
      onPatched(status.id, {
        name: rollback.name,
        color: rollback.color,
        description: rollback.description || null,
      });
      setState("idle");
    });
  }

  /** Typing debounces; picking a colour commits at once. */
  function editName(next: string) {
    setName(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const clean = next.trim();
      // An empty field is "I have not finished typing", never "call it
      // nothing" — the status keeps the name it has.
      if (clean) save({ name: clean });
    }, SAVE_DEBOUNCE_MS);
  }

  function editDescription(next: string) {
    setDescription(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(
      () => save({ description: next.trim() || null }),
      SAVE_DEBOUNCE_MS,
    );
  }

  /** Flush a pending debounce — on blur, on Enter, and on unmount. */
  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  // A half-typed name must still land if you navigate away mid-word.
  useEffect(() => {
    const pending = timer;
    return () => {
      if (pending.current) clearTimeout(pending.current);
    };
  }, []);

  return (
    <li className="flex flex-col gap-2 px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        {/* THE ROW IS ITS OWN PREVIEW. This is the same chrome a task row's
            status pill wears, so the colour you are picking is shown at the
            size and against the background you will actually meet it — the
            roles workbench does the same with its badge, and for the same
            reason: a 12px dot tells you almost nothing about a colour. */}
        <span
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs"
          aria-hidden
        >
          <span
            className="size-2 shrink-0 rounded-full transition-colors"
            style={{ backgroundColor: status.color }}
          />
          <span className="max-w-[9rem] truncate text-muted-foreground">
            {name || status.name}
          </span>
        </span>
        {canEdit ? (
          <Input
            value={name}
            // NOT disabled while saving. A field that goes dead under your
            // fingers is the latency, whether or not the request is fast.
            onChange={(e) => editName(e.target.value)}
            onBlur={() => {
              flush();
              const next = name.trim();
              if (next) save({ name: next });
              else setName(committed.current.name);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                flush();
                const next = name.trim();
                if (next) save({ name: next });
              }
            }}
            aria-label={t("statuses_name")}
            className="h-8 flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
        ) : (
          <span className="flex-1 text-sm">{status.name}</span>
        )}

        {/* Where it CAME FROM, not what can be done to it — a preset renames,
            recolours and re-describes like any other. Canopy labels its shipped
            statuses the same way rather than presenting them as the firm's. */}
        {/* Feedback WITHOUT a wait. The row no longer greys out, so this is the
            only thing telling you the write landed — and it is the right
            amount: present when it matters, gone a moment later. */}
        <span
          aria-live="polite"
          className={cn(
            "shrink-0 text-[10px] font-medium uppercase tracking-wide transition-opacity duration-300",
            state === "idle" ? "opacity-0" : "opacity-100",
            state === "saved" ? "text-success" : "text-muted-foreground",
          )}
        >
          {state === "saving" ? t("statuses_saving") : t("statuses_saved")}
        </span>

        {status.isBuiltin && (
          <span className="shrink-0 rounded-full border border-border/70 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("statuses_preset")}
          </span>
        )}

        {canEdit && (
          <>
            <ColorDots
              value={status.color}
              onChange={(color) => save({ color })}
              t={t}
            />
            {/* Order is the order people READ them in, so reordering is part
                of naming them rather than a separate power. Arrows, not drag:
                a drag target this small is a coin toss, and the list is three
                to eight rows. */}
            <button
              type="button"
              onClick={() => onMove(status.id, "up")}
              disabled={!canMoveUp}
              aria-label={t("statuses_move_up", { name: status.name })}
              title={t("statuses_move_up", { name: status.name })}
              className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ChevronUp className="size-3.5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => onMove(status.id, "down")}
              disabled={!canMoveDown}
              aria-label={t("statuses_move_down", { name: status.name })}
              title={t("statuses_move_down", { name: status.name })}
              className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ChevronDown className="size-3.5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={lastInBucket}
              aria-label={
                lastInBucket
                  ? t("statuses_last_in_bucket")
                  : t("statuses_delete", { name: status.name })
              }
              title={
                lastInBucket
                  ? t("statuses_last_in_bucket")
                  : t("statuses_delete", { name: status.name })
              }
              className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-muted-foreground"
            >
              <Trash2 className="size-3.5" aria-hidden />
            </button>
          </>
        )}
      </div>

      {/* Under the name, indented to the dot, because it explains the thing
          above it. Committed on blur like the name — a write per keystroke is
          the lag this repo keeps removing. */}
      {canEdit ? (
        <Input
          value={description}
          maxLength={DESCRIPTION_MAX}
          onChange={(e) => editDescription(e.target.value)}
          onBlur={() => {
            flush();
            save({ description: description.trim() || null });
          }}
          aria-label={t("statuses_description_for", { name: status.name })}
          placeholder={t("statuses_description_placeholder")}
          className="ml-[22px] h-7 border-0 bg-transparent px-0 text-xs text-muted-foreground shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
      ) : (
        status.description && (
          <p className="ml-[22px] text-xs text-muted-foreground">
            {status.description}
          </p>
        )
      )}

      {/* Canopy: "Custom statuses display the team member who created them and
          the creation date." A preset shows its badge instead — nobody in the
          firm made it, so there is nobody to name. */}
      {!status.isBuiltin && status.createdByName && status.createdAt && (
        <p className="ml-[22px] text-[11px] text-muted-foreground/80">
          {t("statuses_added_by", {
            name: status.createdByName,
            date: formatDate(status.createdAt, locale),
          })}
        </p>
      )}

      {confirming && canEdit && (
        <div className="flex flex-col gap-2 rounded-md bg-muted/60 p-2.5">
          {/* Naming the destination is the point: a status that vanished would
              leave its tasks falling back to a default label, which reads as
              those tasks quietly reclassifying themselves. */}
          <p className="text-xs text-muted-foreground">
            {t("statuses_delete_where")}
          </p>
          <div className="flex items-center gap-2">
            <Select value={replacement} onValueChange={setReplacement}>
              <SelectTrigger
                className="h-8 flex-1"
                aria-label={t("statuses_delete_where")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statuses
                  .filter((s) => s.id !== status.id)
                  .map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={!replacement || deleting}
              onClick={async () => {
                setDeleting(true);
                try {
                  if (
                    onSaved(
                      await deleteStatusAction({
                        id: status.id,
                        replacementId: replacement,
                      }),
                    )
                  ) {
                    onRemoved(status.id);
                  }
                } finally {
                  setDeleting(false);
                }
              }}
            >
              {t("statuses_delete_confirm")}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

// Long enough that a normal typing pause does not write per word, short enough
// that tabbing away lands after it has saved. Same number the roles workbench
// settled on, deliberately — two editors that feel different while doing the
// same job is how an app stops feeling like one product.
const SAVE_DEBOUNCE_MS = 700;

function ColorPicker({
  value,
  onChange,
  t,
}: {
  value: string;
  onChange: (color: string) => void;
  t: ReturnType<typeof useTranslations<"Settings">>;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-xs">{t("statuses_color")}</Label>
      <ColorDots value={value} onChange={onChange} t={t} />
    </div>
  );
}

function ColorDots({
  value,
  onChange,
  t,
}: {
  value: string;
  onChange: (color: string) => void;
  t: ReturnType<typeof useTranslations<"Settings">>;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      {SWATCHES.map((color) => (
        <button
          key={color}
          type="button"
          onClick={() => onChange(color)}
          aria-label={t("statuses_color_pick", { color })}
          aria-pressed={value.toLowerCase() === color}
          className={cn(
            "relative flex size-5 items-center justify-center rounded-full transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            value.toLowerCase() === color
              ? "ring-2 ring-foreground ring-offset-2 ring-offset-background"
              : "hover:scale-115",
          )}
          style={{ backgroundColor: color }}
        >
          {/* A ring alone reads as "focused" as easily as "chosen". The tick
              is unambiguous, and it is the only thing on this row somebody
              scanning eight near-identical circles can actually land on. */}
          {value.toLowerCase() === color && (
            <Check className="size-3 text-white drop-shadow-sm" aria-hidden />
          )}
        </button>
      ))}
    </div>
  );
}
