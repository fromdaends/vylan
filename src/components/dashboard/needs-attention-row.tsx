"use client";

import { Link } from "@/i18n/navigation";
import {
  AlertTriangle,
  Clock,
  FileWarning,
  CheckCheck,
  MoreHorizontal,
  type LucideIcon,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useEngagementRowMenu,
  type EngagementLifecycleState,
} from "@/components/engagements/engagement-row-menu";
import type { WorklistRow } from "@/components/dashboard/engagements-worklist";
import type { NeedsAttentionBadge } from "@/components/dashboard/needs-attention";

const BADGE_ICONS: Record<NeedsAttentionBadge["iconKey"], LucideIcon> = {
  overdue: AlertTriangle,
  due_soon: Clock,
  stale: FileWarning,
  ready: CheckCheck,
};

// One Needs-attention row. Reuses the exact same engagement row menu as the
// My-engagements table (useEngagementRowMenu → Open / Archive / Delete, the
// delete-confirm dialog, undo toasts, owner-only delete). Right-click anywhere
// opens the context menu; the "..." button opens the same menu; left-clicking
// the row still navigates to the engagement (the link sits under the "..."
// button, which is relative z-10 so its click opens the menu instead).
export function NeedsAttentionRow({
  row,
  canDelete,
  menuActionsLabel,
  badge,
}: {
  row: WorklistRow;
  canDelete: boolean;
  menuActionsLabel: string;
  badge: NeedsAttentionBadge | null;
}) {
  // Needs-attention only ever lists active engagements, but derive the state
  // the same way the worklist does so the menu options always match.
  const lifecycleState: EngagementLifecycleState = row.deletedAt
    ? "deleted"
    : row.archivedAt
      ? "archived"
      : "active";
  const { items, dialog } = useEngagementRowMenu({
    engagementId: row.id,
    title: row.title,
    state: lifecycleState,
    canDelete,
  });

  const BadgeIcon = badge ? BADGE_ICONS[badge.iconKey] : null;

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <li className="group relative flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-accent/10">
            {/* Full-row link overlay — clicking the row opens the engagement. */}
            <Link
              href={`/engagements/${row.id}`}
              className="absolute inset-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={row.title}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-foreground">
                {row.title}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {row.clientName}
              </div>
            </div>
            {badge && BadgeIcon && (
              <span
                className={
                  "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium " +
                  badge.tone
                }
              >
                <BadgeIcon className="h-3 w-3" aria-hidden />
                {badge.label}
              </span>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={menuActionsLabel}
                  className="relative z-10 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/20 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <MoreHorizontal className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                {items.map((it) => {
                  const Icon = it.icon;
                  return (
                    <DropdownMenuItem
                      key={it.key}
                      variant={it.variant}
                      onSelect={it.onSelect}
                    >
                      <Icon />
                      {it.label}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-44">
          {items.map((it) => {
            const Icon = it.icon;
            return (
              <ContextMenuItem
                key={it.key}
                variant={it.variant}
                onSelect={it.onSelect}
              >
                <Icon />
                {it.label}
              </ContextMenuItem>
            );
          })}
        </ContextMenuContent>
      </ContextMenu>
      {dialog}
    </>
  );
}
