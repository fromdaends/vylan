"use client";

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
import { Card, CardContent } from "@/components/ui/card";
import { MoreHorizontal } from "lucide-react";
import { ClientFormDialog } from "./client-form-dialog";
import {
  archiveClientAction,
  restoreClientAction,
} from "@/app/actions/clients";
import type { Client } from "@/lib/db/clients";

export type ClientEngagementSummary = {
  draft: number;
  sent: number;
  in_progress: number;
  complete: number;
  cancelled: number;
  total_live: number;
};

export function ClientsTable({
  clients,
  summaries,
  locale,
}: {
  clients: Client[];
  summaries: Record<string, ClientEngagementSummary>;
  locale: "fr" | "en";
}) {
  const t = useTranslations("Clients");

  if (clients.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          {t("empty")}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="rounded-lg border border-border overflow-hidden bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("col_name")}</TableHead>
            <TableHead>{t("col_type")}</TableHead>
            <TableHead>{t("col_email")}</TableHead>
            <TableHead>{t("col_phone")}</TableHead>
            <TableHead>{t("col_engagements")}</TableHead>
            <TableHead className="w-12 text-right" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {clients.map((c) => (
            <TableRow key={c.id}>
              <TableCell className="font-medium">
                <Link
                  href={`/clients/${c.id}`}
                  className="hover:underline"
                >
                  {c.display_name}
                </Link>
                {c.external_ref && (
                  <span className="ml-2 text-xs font-mono text-muted-foreground">
                    {c.external_ref}
                  </span>
                )}
                {c.archived_at && (
                  <Badge variant="outline" className="ml-2 text-xs">
                    {t("archived")}
                  </Badge>
                )}
              </TableCell>
              <TableCell>
                <Badge variant="secondary">
                  {c.type === "individual"
                    ? t("type_individual")
                    : t("type_business")}
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {c.email ?? "—"}
              </TableCell>
              <TableCell className="text-muted-foreground font-mono text-xs">
                {c.phone ?? "—"}
              </TableCell>
              <TableCell>
                <EngagementSummaryCell summary={summaries[c.id]} />
              </TableCell>
              <TableCell className="text-right">
                <RowActions client={c} locale={locale} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
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
