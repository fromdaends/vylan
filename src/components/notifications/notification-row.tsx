"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  Bell,
  CheckCheck,
  CheckCircle2,
  CreditCard,
  FileSignature,
  FileUp,
  MessageSquare,
  MoreHorizontal,
  Plug,
  Sparkles,
  Trash2,
  UserRoundCheck,
  UserRoundPlus,
  Wallet,
  Clock,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { formatRelative, type AppLocale } from "@/lib/format";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  dismissNotificationAction,
  setNotificationReadAction,
} from "@/app/actions/notifications";
import type { FeedItem } from "@/lib/notifications/feed";

// Icon + accent per event. Falls back on category so a new catalog event never
// renders without an icon.
function visualFor(eventKey: string, category: string): {
  Icon: LucideIcon;
  tone: string;
} {
  switch (eventKey) {
    case "document.uploaded":
      return { Icon: FileUp, tone: "bg-primary/15 text-primary" };
    case "document.request_complete":
      return { Icon: CheckCheck, tone: "bg-success/15 text-success" };
    case "document.ai_flagged":
      return { Icon: Sparkles, tone: "bg-primary/15 text-primary" };
    case "document.ai_rejected":
    case "document.ai_escalated":
      return { Icon: AlertTriangle, tone: "bg-warning/15 text-warning" };
    case "engagement.assigned_to_you":
      return { Icon: UserRoundCheck, tone: "bg-primary/15 text-primary" };
    case "engagement.due_soon":
    case "engagement.stalled":
      return { Icon: Clock, tone: "bg-warning/15 text-warning" };
    case "engagement.overdue":
      return { Icon: AlertTriangle, tone: "bg-destructive/15 text-destructive" };
    case "engagement.completed":
      return { Icon: CheckCircle2, tone: "bg-success/15 text-success" };
    case "signature.completed":
    case "signature.signed_copy_returned":
      return { Icon: FileSignature, tone: "bg-success/15 text-success" };
    case "signature.declined":
      return { Icon: FileSignature, tone: "bg-destructive/15 text-destructive" };
    case "payment.received":
      return { Icon: Wallet, tone: "bg-success/15 text-success" };
    case "payment.failed":
    case "billing.payment_failed":
      return { Icon: CreditCard, tone: "bg-destructive/15 text-destructive" };
    case "message.client_replied":
    case "message.internal_mention":
      return { Icon: MessageSquare, tone: "bg-primary/15 text-primary" };
    case "client.portal_first_opened":
      return { Icon: UserRoundCheck, tone: "bg-primary/15 text-primary" };
    case "team.member_joined":
      return { Icon: UserRoundPlus, tone: "bg-primary/15 text-primary" };
    case "integration.sync_failed":
    case "integration.disconnected":
      return { Icon: Plug, tone: "bg-destructive/15 text-destructive" };
    default:
      return {
        Icon: Bell,
        tone:
          category === "payments"
            ? "bg-success/15 text-success"
            : "bg-primary/15 text-primary",
      };
  }
}

export function NotificationRow({
  item,
  locale,
  compact = false,
  onChanged,
}: {
  item: FeedItem;
  locale: AppLocale;
  compact?: boolean;
  // Lets the parent drop the row optimistically (popover) or refresh (page).
  onChanged?: (id: string, change: "read" | "unread" | "deleted") => void;
}) {
  const t = useTranslations("Notifications");
  const [pending, startTransition] = useTransition();
  const { Icon, tone } = visualFor(item.eventKey, item.category);
  const unread = item.readAt === null;

  function toggleRead() {
    const next = unread;
    onChanged?.(item.id, next ? "read" : "unread");
    startTransition(async () => {
      const res = await setNotificationReadAction({ id: item.id, read: next });
      if (!res.ok) {
        // Roll the optimistic change back — a badge that silently disagrees
        // with the server is worse than a slow one.
        onChanged?.(item.id, next ? "unread" : "read");
        toast.error(t("save_error"));
      }
    });
  }

  function remove() {
    onChanged?.(item.id, "deleted");
    startTransition(async () => {
      const res = await dismissNotificationAction({ id: item.id });
      if (res.ok) {
        toast.success(t("deleted_toast"));
      } else {
        toast.error(t("save_error"));
      }
    });
  }

  // Context line: whichever of engagement / client we know, plus a bundled
  // count when several occurrences collapsed into this row.
  const contextBits = [item.engagementTitle, item.clientName].filter(Boolean);

  const body = (
    <div
      className={cn(
        "group relative flex items-start gap-3 rounded-lg pr-1 transition-colors",
        compact ? "px-2 py-2.5" : "px-2 py-3.5",
        unread ? "bg-primary/[0.04]" : "hover:bg-secondary/40",
        pending && "opacity-60",
      )}
    >
      {/* Unread accent bar in brand blue — the "blue thing next to it". */}
      {unread && (
        <span
          aria-hidden
          className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-primary"
        />
      )}
      <span
        className={cn(
          "mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          tone,
        )}
        aria-hidden
      >
        <Icon className="h-4 w-4" />
      </span>

      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "text-sm leading-snug",
            unread ? "font-semibold" : "font-medium",
          )}
        >
          {t(item.labelKey as never)}
          {item.count > 1 && (
            <span className="ml-1.5 rounded-full bg-secondary px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
              {item.count}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          {contextBits.map((bit, i) => (
            <span key={i} className="truncate max-w-[16rem]">
              {i > 0 && <span aria-hidden className="mr-2">·</span>}
              {bit}
            </span>
          ))}
          {contextBits.length > 0 && <span aria-hidden>·</span>}
          <span>{formatRelative(item.createdAt, locale)}</span>
        </div>
        {item.note && (
          <div className="mt-1 line-clamp-2 text-xs italic text-muted-foreground/90">
            &ldquo;{item.note}&rdquo;
          </div>
        )}
      </div>

      {/* Explicit affordance. Right-click works too, but a menu that ONLY
          opens on right-click is invisible on touch and to anyone who never
          tries it. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t("row_actions")}
            onClick={(e) => {
              // The row is a link; the menu button must not navigate.
              e.preventDefault();
              e.stopPropagation();
            }}
            className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/50 opacity-0 transition-opacity hover:bg-secondary hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              toggleRead();
            }}
          >
            {unread ? t("mark_read") : t("mark_unread")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={(e) => {
              e.preventDefault();
              remove();
            }}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            {t("delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Link
          href={item.href}
          className="block"
          // Opening a notification marks it read, which is what every inbox
          // does and what makes the badge trustworthy.
          onClick={() => {
            if (unread) {
              onChanged?.(item.id, "read");
              void setNotificationReadAction({ id: item.id, read: true });
            }
          }}
        >
          {body}
        </Link>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-44">
        <ContextMenuItem
          onSelect={(e) => {
            e.preventDefault();
            toggleRead();
          }}
        >
          {unread ? t("mark_read") : t("mark_unread")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          onSelect={(e) => {
            e.preventDefault();
            remove();
          }}
        >
          <Trash2 className="h-4 w-4" aria-hidden />
          {t("delete")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
