"use client";

import { Link } from "@/i18n/navigation";
import {
  AlertTriangle,
  Clock,
  FileWarning,
  CheckCheck,
  Flag,
  Hourglass,
  PenLine,
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
  flagged: Flag,
  signed_copy: PenLine,
  sitting: Hourglass,
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
  accent,
  context,
  href,
}: {
  row: WorklistRow;
  canDelete: boolean;
  menuActionsLabel: string;
  // The ONE colored reason chip (the most actionable signal), or null when
  // only passive context applies.
  accent: NeedsAttentionBadge | null;
  // The remaining applicable reasons, rendered as quiet muted text.
  context: string[];
  // Row destination — the engagement page, or the Preview deep-link when
  // flagged files make that the better landing.
  href?: string;
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
  const AccentIcon = accent ? BADGE_ICONS[accent.iconKey] : null;

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <li className="group relative flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-accent/10">
            {/* Full-row link overlay — clicking the row opens the engagement
                (or the Preview deep-link when that's the better landing). */}
            <Link
              href={href ?? `/engagements/${row.id}`}
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
            {(accent != null || context.length > 0) && (
              <span className="flex max-w-[60%] shrink-0 flex-wrap items-center justify-end gap-x-2 gap-y-1">
                {/* Passive/supporting reasons: quiet text, no pill, no icon —
                    readable but never competing with the accent chip. One span
                    per reason (nowrap) so narrow screens wrap between reasons,
                    never mid-phrase. */}
                {context.map((label, i) => (
                  <span
                    key={label}
                    className="whitespace-nowrap text-xs text-muted-foreground"
                  >
                    {label}
                    {i < context.length - 1 && <span aria-hidden> ·</span>}
                  </span>
                ))}
                {accent != null && AccentIcon != null && (
                  <span
                    className={
                      "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium " +
                      accent.tone
                    }
                  >
                    <AccentIcon className="h-3 w-3" aria-hidden />
                    {accent.label}
                  </span>
                )}
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
