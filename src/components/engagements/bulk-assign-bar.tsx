"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { UserRound, X } from "lucide-react";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { bulkAssignEngagementsAction } from "@/app/actions/engagements";
import { BULK_ASSIGN_MAX } from "@/lib/engagements/bulk-assign";

// The bar that appears once you tick rows. Karbon's shape, and the one thing
// they have on assignment that Vylan didn't: filter a work list, tick the rows,
// move them all at once. Before this the only bulk path was "Hand over
// EVERYTHING" on a teammate's profile — all-or-nothing and owner-only, so
// moving eight of somebody's twelve files meant eight separate actions.
//
// It floats over the list rather than pushing it down, so ticking a row never
// reflows the thing you are ticking. Only mounted when something is selected —
// no permanently-parked toolbar over an untouched list, which is the founder's
// standing objection to controls that sit there doing nothing.
export function BulkAssignBar({
  selectedIds,
  members,
  onDone,
  onClear,
}: {
  selectedIds: string[];
  members: { id: string; name: string }[];
  // Fired after a successful move so the list can drop its selection and
  // refresh. The server already revalidated; this is the client catching up.
  onDone: () => void;
  onClear: () => void;
}) {
  const t = useTranslations("Engagements");
  const [pending, start] = useTransition();
  const count = selectedIds.length;
  if (count === 0) return null;

  const run = (assigneeId: string | null, label: string) => {
    if (pending) return;
    start(async () => {
      const res = await bulkAssignEngagementsAction(selectedIds, assigneeId);
      if (res.ok) {
        toast.success(
          assigneeId === null
            ? t("bulk_moved", { count: res.moved ?? 0 })
            : `${t("assigned_toast", { name: label })} · ${t("bulk_moved", { count: res.moved ?? 0 })}`,
        );
        onDone();
      } else if (res.error === "too_many") {
        toast.error(t("bulk_too_many", { max: BULK_ASSIGN_MAX }));
      } else {
        toast.error(t("bulk_failed"));
      }
    });
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
      <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-border bg-popover/95 py-2 pl-4 pr-2 text-sm shadow-lg backdrop-blur supports-[backdrop-filter]:bg-popover/80">
        <span className="font-medium tabular-nums">
          {t("bulk_selected", { count })}
        </span>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity disabled:opacity-50"
            >
              <UserRound className="size-3.5" aria-hidden />
              {t("bulk_assign_to")}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" side="top" className="w-56">
            {members.map((m) => (
              <DropdownMenuItem
                key={m.id}
                onSelect={() => run(m.id, m.name)}
                className="gap-2"
              >
                <AvatarInitials name={m.name} size={20} />
                <span className="flex-1 truncate">{m.name}</span>
              </DropdownMenuItem>
            ))}
            {/* Unassigning in bulk is a real need, not an edge case: it is how
                you clear a leaver's plate before deciding where each file goes. */}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => run(null, "")} className="gap-2">
              <span className="inline-flex size-5 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <UserRound className="size-3" aria-hidden />
              </span>
              <span className="flex-1 truncate">{t("assign_nobody")}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <button
          type="button"
          onClick={onClear}
          disabled={pending}
          aria-label={t("bulk_clear")}
          title={t("bulk_clear")}
          className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
