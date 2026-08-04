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
import { Plus, Trash2 } from "lucide-react";
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
  type StatusActionResult,
} from "@/app/actions/task-statuses";

type Bucket = "todo" | "doing" | "done";
export type EditableStatus = {
  id: string;
  name: string;
  color: string;
  bucket: Bucket;
};

const BUCKETS: Bucket[] = ["todo", "doing", "done"];

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
}: {
  statuses: EditableStatus[];
  /** Owner only. Everyone else reads the list — every task row renders one. */
  canEdit: boolean;
}) {
  const t = useTranslations("Settings");
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftColor, setDraftColor] = useState(SWATCHES[0]);
  const [draftBucket, setDraftBucket] = useState<Bucket>("todo");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  function report(res: StatusActionResult): boolean {
    if (res.ok) {
      startTransition(() => router.refresh());
      return true;
    }
    toast.error(
      res.error === "duplicate"
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
      if (
        report(
          await createStatusAction({
            name: draftName.trim(),
            color: draftColor,
            bucket: draftBucket,
          }),
        )
      ) {
        setDraftName("");
        setAdding(false);
      }
    } finally {
      setBusy(false);
    }
  }

  const inBucket = (b: Bucket) => statuses.filter((s) => s.bucket === b);

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
                statuses={statuses}
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
  confirming,
  onConfirm,
  onSaved,
  t,
}: {
  status: EditableStatus;
  statuses: EditableStatus[];
  canEdit: boolean;
  confirming: boolean;
  onConfirm: () => void;
  onSaved: (res: StatusActionResult) => boolean;
  t: ReturnType<typeof useTranslations<"Settings">>;
}) {
  const [name, setName] = useState(status.name);
  const [busy, setBusy] = useState(false);
  // Where its tasks go. Anything in the firm except this one — including
  // another bucket, which is a real choice: "this stage turned out to be done".
  const [replacement, setReplacement] = useState(
    statuses.find((s) => s.id !== status.id)?.id ?? "",
  );

  async function save(patch: { name?: string; color?: string }) {
    setBusy(true);
    try {
      onSaved(await updateStatusAction({ id: status.id, ...patch }));
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

        {canEdit && (
          <>
            <ColorDots
              value={status.color}
              onChange={(color) => save({ color })}
              t={t}
            />
            <button
              type="button"
              onClick={onConfirm}
              aria-label={t("statuses_delete", { name: status.name })}
              className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Trash2 className="size-3.5" aria-hidden />
            </button>
          </>
        )}
      </div>

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
                  onSaved(
                    await deleteStatusAction({
                      id: status.id,
                      replacementId: replacement,
                    }),
                  );
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
