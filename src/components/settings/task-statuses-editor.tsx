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

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
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

  function report(res: StatusActionResult): boolean {
    if (res.ok) {
      // Still refresh: the server remains the source of truth, and this pulls
      // back anything the optimistic patch could not know (sort order, another
      // owner's concurrent edit). It is no longer what makes the change VISIBLE.
      startTransition(() => router.refresh());
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
  const removeRow = (id: string) =>
    setRows((prev) => prev.filter((r) => r.id !== id));

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
      if (!report(await moveStatusAction({ id, direction }))) setRows(before);
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
  const [busy, setBusy] = useState(false);
  // Where its tasks go. Anything in the firm except this one — including
  // another bucket, which is a real choice: "this stage turned out to be done".
  const [replacement, setReplacement] = useState(
    statuses.find((s) => s.id !== status.id)?.id ?? "",
  );

  async function save(patch: {
    name?: string;
    color?: string;
    description?: string | null;
  }) {
    setBusy(true);
    try {
      // Patch the list the moment the server accepts it. Without this the row
      // keeps rendering the OLD prop until a refresh lands, which is what made
      // every colour click look like it did nothing.
      if (onSaved(await updateStatusAction({ id: status.id, ...patch }))) {
        onPatched(status.id, patch);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-2 px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        <span
          className="size-3 shrink-0 rounded-full"
          style={{ backgroundColor: status.color }}
          aria-hidden
        />
        {canEdit ? (
          <Input
            value={name}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              const next = name.trim();
              if (next && next !== status.name) save({ name: next });
              else setName(status.name);
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
              disabled={!canMoveUp || busy}
              aria-label={t("statuses_move_up", { name: status.name })}
              title={t("statuses_move_up", { name: status.name })}
              className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ChevronUp className="size-3.5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => onMove(status.id, "down")}
              disabled={!canMoveDown || busy}
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
          disabled={busy}
          maxLength={DESCRIPTION_MAX}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => {
            const next = description.trim();
            if (next !== (status.description ?? "")) {
              save({ description: next || null });
            }
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
              disabled={!replacement || busy}
              onClick={async () => {
                setBusy(true);
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
                  setBusy(false);
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
            "size-4 rounded-full transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            value.toLowerCase() === color
              ? "ring-2 ring-foreground ring-offset-2 ring-offset-background"
              : "hover:scale-110",
          )}
          style={{ backgroundColor: color }}
        />
      ))}
    </div>
  );
}
