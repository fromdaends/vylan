"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import {
  MoreHorizontal,
  ChevronDown,
  ChevronRight,
  ArrowUpRight,
  FileText,
} from "lucide-react";
import { ClientFormDialog } from "./client-form-dialog";
import {
  archiveClientAction,
  restoreClientAction,
} from "@/app/actions/clients";
import type { ClientOwner } from "./owner";
import type { Client } from "@/lib/db/clients";
import type { EngagementStatus } from "@/lib/db/engagements";
import type { EngagementType } from "@/lib/db/templates";
import { formatDate, type AppLocale } from "@/lib/format";
import { cn } from "@/lib/cn";
import { engagementStatusPillClass } from "@/lib/engagements/status-pill";

export type ClientEngagementSummary = {
  draft: number;
  sent: number;
  in_progress: number;
  complete: number;
  cancelled: number;
  total_live: number;
};

// Minimal slice of an engagement row needed to render the expanded
// drawer beneath a client. The page picks these columns out of the
// listEngagements result so the table component doesn't need the
// full row shape.
export type ClientEngagementRow = {
  id: string;
  title: string;
  type: EngagementType;
  // Unified display status (lib/attention deriveEngagementStatus) — the page
  // passes the derived value so the drawer pill matches every other surface.
  status: EngagementStatus | "ready_to_review";
  due_date: string | null;
};

export function ClientsTable({
  clients,
  summaries,
  engagementsByClient,
  owners,
  currentUserId,
  locale,
  teamEnabled,
}: {
  clients: Client[];
  summaries: Record<string, ClientEngagementSummary>;
  engagementsByClient: Record<string, ClientEngagementRow[]>;
  owners: Record<string, ClientOwner>;
  currentUserId: string;
  locale: AppLocale;
  teamEnabled: boolean;
}) {
  const t = useTranslations("Clients");
  // Set of expanded client ids. Multi-expand by design — comparing two
  // clients side-by-side is a real workflow at tax season.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  if (clients.length === 0) {
    return (
      <div className="py-16 text-center text-sm text-muted-foreground">
        {t("empty")}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto border-t border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8" />
            {/* On a wide monitor (>=1800px) the Name column absorbs the extra
                space so Type / Email / Phone / Engagements / Owner stay grouped
                at natural widths instead of drifting apart. Unchanged below. */}
            <TableHead className="py-3 min-[1800px]:w-full">
              {t("col_name")}
            </TableHead>
            <TableHead className="py-3">{t("col_type")}</TableHead>
            <TableHead className="py-3">{t("col_email")}</TableHead>
            <TableHead className="py-3">{t("col_phone")}</TableHead>
            <TableHead className="py-3">{t("col_engagements")}</TableHead>
            {teamEnabled && (
              <TableHead className="py-3">{t("col_owner")}</TableHead>
            )}
            <TableHead className="w-12 text-right" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {clients.map((c) => {
            const isOpen = expanded.has(c.id);
            const rows = engagementsByClient[c.id] ?? [];
            return (
              <ClientRowWithDrawer
                key={c.id}
                client={c}
                summary={summaries[c.id]}
                engagements={rows}
                owner={
                  c.assigned_user_id ? owners[c.assigned_user_id] : undefined
                }
                isYou={
                  c.assigned_user_id != null &&
                  c.assigned_user_id === currentUserId
                }
                isOpen={isOpen}
                onToggle={() => toggle(c.id)}
                locale={locale}
                teamEnabled={teamEnabled}
              />
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function ClientRowWithDrawer({
  client,
  summary,
  engagements,
  owner,
  isYou,
  isOpen,
  onToggle,
  locale,
  teamEnabled,
}: {
  client: Client;
  summary: ClientEngagementSummary | undefined;
  engagements: ClientEngagementRow[];
  owner: ClientOwner | undefined;
  isYou: boolean;
  isOpen: boolean;
  onToggle: () => void;
  locale: AppLocale;
  teamEnabled: boolean;
}) {
  const t = useTranslations("Clients");
  // Stop propagation so clicking the name (Link) or the actions menu
  // (DropdownMenu trigger) doesn't ALSO toggle the row. Without this,
  // a single click on the name would navigate AND expand the row,
  // leaving an expanded drawer the user didn't intend the next time
  // they visit /clients.
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <>
      <TableRow
        onClick={onToggle}
        className="cursor-pointer"
        aria-expanded={isOpen}
        data-state={isOpen ? "open" : undefined}
      >
        <TableCell className="py-4 pl-4 pr-0 text-muted-foreground">
          {isOpen ? (
            <ChevronDown className="size-4" aria-hidden />
          ) : (
            <ChevronRight className="size-4" aria-hidden />
          )}
        </TableCell>
        <TableCell className="py-4 font-medium">
          <Link
            href={`/clients/${client.id}`}
            onClick={stop}
            className="hover:underline"
          >
            {client.display_name}
          </Link>
          {client.external_ref && (
            <span className="ml-2 text-xs font-mono text-muted-foreground">
              {client.external_ref}
            </span>
          )}
          {client.archived_at && (
            <Badge variant="outline" className="ml-2 text-xs">
              {t("archived")}
            </Badge>
          )}
        </TableCell>
        <TableCell className="py-4">
          <Badge variant="secondary">
            {client.type === "individual"
              ? t("type_individual")
              : t("type_business")}
          </Badge>
        </TableCell>
        <TableCell className="py-4 text-muted-foreground">
          {client.email ?? "—"}
        </TableCell>
        <TableCell className="py-4 text-muted-foreground font-mono text-xs">
          {client.phone ?? "—"}
        </TableCell>
        <TableCell className="py-4">
          <EngagementSummaryCell summary={summary} />
        </TableCell>
        {teamEnabled && (
          <TableCell className="py-4">
            <OwnerCell owner={owner} isYou={isYou} />
          </TableCell>
        )}
        <TableCell className="py-4 pr-4 text-right" onClick={stop}>
          <RowActions client={client} locale={locale} />
        </TableCell>
      </TableRow>
      {isOpen && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={teamEnabled ? 8 : 7} className="px-6 py-4">
            <ExpandedDrawer
              clientId={client.id}
              engagements={engagements}
              locale={locale}
            />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function ExpandedDrawer({
  clientId,
  engagements,
  locale,
}: {
  clientId: string;
  engagements: ClientEngagementRow[];
  locale: AppLocale;
}) {
  const t = useTranslations("Clients");
  const tStatus = useTranslations("Status");

  return (
    <div className="space-y-3 animate-in-fade">
      {engagements.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("drawer_no_engagements")}
        </p>
      ) : (
        <ul className="divide-y divide-border/50">
          {engagements.map((e) => (
            <li key={e.id}>
              <Link
                href={`/engagements/${e.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-secondary/40 transition-colors"
              >
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-muted text-muted-foreground shrink-0">
                  <FileText className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium truncate">
                    {e.title}
                  </span>
                  <span className="block text-xs text-muted-foreground mt-0.5">
                    <span className="font-mono uppercase tracking-wider">
                      {e.type}
                    </span>
                    {e.due_date && (
                      <>
                        <span className="mx-2 text-border">·</span>
                        {t("drawer_due", {
                          date: formatDate(e.due_date, locale, "medium"),
                        })}
                      </>
                    )}
                  </span>
                </span>
                <Badge
                  variant={statusVariant(e.status)}
                  className={cn(
                    "shrink-0",
                    engagementStatusPillClass(e.status),
                  )}
                >
                  {tStatus(e.status)}
                </Badge>
                <ArrowUpRight
                  className="size-4 text-muted-foreground shrink-0"
                  aria-hidden
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-end">
        <Link href={`/clients/${clientId}`}>
          <Button variant="outline" size="sm">
            {t("drawer_view_full_page")}
            <ArrowUpRight className="size-3.5" />
          </Button>
        </Link>
      </div>
    </div>
  );
}

// Map engagement status to the existing Badge variant set so the
// drawer's status pills match the rest of the app.
function statusVariant(
  status: EngagementStatus | "ready_to_review",
): "default" | "secondary" | "outline" | "destructive" {
  switch (status) {
    case "in_progress":
    case "sent":
    case "ready_to_review":
      return "secondary";
    case "draft":
      return "outline";
    case "complete":
      return "default";
    case "cancelled":
      return "destructive";
  }
}

function EngagementSummaryCell({
  summary,
}: {
  summary: ClientEngagementSummary | undefined;
}) {
  const t = useTranslations("Clients");
  if (!summary) {
    return <span className="text-muted-foreground text-sm">—</span>;
  }
  // Pick the most useful badge per priority:
  //   in_progress > sent > draft > complete (only if nothing else) > none
  if (summary.in_progress > 0) {
    return (
      <Badge variant="secondary">
        {t("summary_in_progress", { count: summary.in_progress })}
      </Badge>
    );
  }
  if (summary.sent > 0) {
    return (
      <Badge variant="secondary">
        {t("summary_sent", { count: summary.sent })}
      </Badge>
    );
  }
  if (summary.draft > 0) {
    return (
      <Badge variant="outline">
        {t("summary_draft", { count: summary.draft })}
      </Badge>
    );
  }
  if (summary.complete > 0) {
    return (
      <Badge>{t("summary_complete", { count: summary.complete })}</Badge>
    );
  }
  return <span className="text-muted-foreground text-sm">—</span>;
}

// Owner ("belongs to") cell — the firm member who owns this client. Shows their
// avatar + name, with a "(you)" marker when it's the current user. Unassigned
// clients (no owner, or the owner was removed) show a muted placeholder.
function OwnerCell({
  owner,
  isYou,
}: {
  owner: ClientOwner | undefined;
  isYou: boolean;
}) {
  const t = useTranslations("Clients");
  if (!owner) {
    return (
      <span className="text-sm text-muted-foreground">
        {t("owner_unassigned")}
      </span>
    );
  }
  return (
    <div className="flex min-w-0 items-center gap-2">
      <AvatarInitials src={owner.avatarUrl} name={owner.name} size={24} />
      <span className="truncate text-sm">
        {owner.name}
        {isYou && (
          <span className="text-muted-foreground"> {t("owner_you")}</span>
        )}
      </span>
    </div>
  );
}

function RowActions({
  client,
  locale,
}: {
  client: Client;
  locale: "fr" | "en";
}) {
  const t = useTranslations("Clients");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t("row_actions")}>
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <ClientFormDialog
          mode="edit"
          locale={locale}
          client={client}
          trigger={
            <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
              {t("edit")}
            </DropdownMenuItem>
          }
        />
        <DropdownMenuItem asChild>
          <Link href={`/clients/${client.id}/archive`}>
            {t("document_archive")}
          </Link>
        </DropdownMenuItem>
        {client.archived_at ? (
          <form action={restoreClientAction}>
            <input type="hidden" name="id" value={client.id} />
            <DropdownMenuItem asChild>
              <button type="submit" className="w-full text-left">
                {t("restore")}
              </button>
            </DropdownMenuItem>
          </form>
        ) : (
          <form action={archiveClientAction}>
            <input type="hidden" name="id" value={client.id} />
            <DropdownMenuItem asChild>
              <button type="submit" className="w-full text-left">
                {t("archive")}
              </button>
            </DropdownMenuItem>
          </form>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
