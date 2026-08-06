"use client";

// The Time list — who spent how long, on what, with the note they left.
//
// DURATIONS ONLY, BY CONSTRUCTION. The rows this component receives come from
// lib/db/time-entries.ts, whose types carry no rate and no dollar field — so a
// money column here is not merely absent, it is unrepresentable. Staff see the
// whole list (shared hours, the founder's ruling); what an hour COST belongs
// to the capability-gated insights side and never to this surface.
//
// Controls follow the founder's standing preferences: per-row compact icon
// buttons (never bulk), hidden until the row is hovered or focused.
// Edit/delete appear on your OWN rows, or on all rows with time.manage —
// mirrored from RLS, which enforces it regardless of what this renders.

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { formatDate, type AppLocale } from "@/lib/format";
import { formatMinutes } from "@/lib/time/duration";
import { deleteTimeEntryAction } from "@/app/actions/time-entries";
import {
  EditEntryDialog,
  type EditableEntry,
} from "@/components/time/edit-entry-dialog";

export type TimeListEntry = {
  id: string;
  userId: string;
  /** YYYY-MM-DD in the firm's day — precomputed server-side. */
  day: string;
  durationMinutes: number;
  note: string | null;
  engagementId: string | null;
  clientId: string;
  /** Shown on surfaces that mix engagements (the client panel). */
  engagementTitle?: string | null;
};

export function TimeEntriesList({
  entries,
  members,
  currentUserId,
  canManage,
  locale,
  showEngagement = false,
}: {
  entries: TimeListEntry[];
  members: { id: string; name: string }[];
  currentUserId: string;
  canManage: boolean;
  locale: AppLocale;
  showEngagement?: boolean;
}) {
  const t = useTranslations("Time");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<EditableEntry | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const names = new Map(members.map((m) => [m.id, m.name]));

  const remove = (entry: TimeListEntry) => {
    startTransition(async () => {
      const res = await deleteTimeEntryAction({
        entryId: entry.id,
        engagementId: entry.engagementId,
        clientId: entry.clientId,
      });
      setConfirmId(null);
      if (res.ok) {
        toast.success(t("list_deleted"));
        router.refresh();
      } else {
        toast.error(
          res.error === "not_allowed" ? t("error_not_allowed") : t("error_generic"),
        );
      }
    });
  };

  return (
    <>
      <ul className="divide-y divide-border/45">
        {entries.map((entry) => {
          const mayTouch = canManage || entry.userId === currentUserId;
          const name = names.get(entry.userId) ?? t("list_former_member");
          return (
            <li
              key={entry.id}
              className="group flex items-center gap-3 py-2"
            >
              <AvatarInitials name={name} className="size-6 shrink-0 text-[10px]" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">
                  {name}
                  {entry.note && (
                    <span className="text-muted-foreground"> · {entry.note}</span>
                  )}
                </p>
                {showEngagement && entry.engagementTitle && (
                  <p className="truncate text-xs text-muted-foreground">
                    {entry.engagementTitle}
                  </p>
                )}
              </div>
              <span className="shrink-0 text-[12.5px] text-muted-foreground">
                {formatDate(entry.day, locale, "compact")}
              </span>
              <span className="w-16 shrink-0 text-right text-sm font-medium tabular-nums">
                {formatMinutes(entry.durationMinutes)}
              </span>
              <span className="flex w-14 shrink-0 items-center justify-end gap-0.5">
                {mayTouch && (
                  <>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                      aria-label={t("list_edit")}
                      onClick={() =>
                        setEditing({
                          id: entry.id,
                          day: entry.day,
                          durationMinutes: entry.durationMinutes,
                          note: entry.note,
                        })
                      }
                    >
                      <Pencil className="size-3.5" aria-hidden />
                    </Button>
                    <Popover
                      open={confirmId === entry.id}
                      onOpenChange={(o) => setConfirmId(o ? entry.id : null)}
                    >
                      <PopoverTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                          aria-label={t("list_delete")}
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent align="end" className="w-56 space-y-2">
                        <p className="text-sm">{t("list_delete_confirm")}</p>
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setConfirmId(null)}
                          >
                            {t("cancel")}
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={pending}
                            onClick={() => remove(entry)}
                          >
                            {t("list_delete")}
                          </Button>
                        </div>
                      </PopoverContent>
                    </Popover>
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <EditEntryDialog
        entry={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          router.refresh();
        }}
      />
    </>
  );
}
