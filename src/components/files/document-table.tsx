import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { FileText } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { DOC_TYPE_LABELS } from "@/lib/doc-types";
import { formatBytes, formatDate, type AppLocale } from "@/lib/format";
import type { BrowseDocument } from "@/lib/db/documents";

// LEVEL 3: the flat file list.
//
// Read-only in this PR. The per-row actions (preview, download, rename, move,
// delete) and multi-select land next, together with the audit events they have
// to emit — shipping the menu before the events would mean a window where files
// can be changed with no record of who did it.
export async function DocumentTable({
  documents,
  locale,
  showClientColumn = false,
  clientNames,
}: {
  documents: BrowseDocument[];
  locale: AppLocale;
  // Firm-wide results (a search) need to say which client each file belongs to;
  // inside a client folder that column would be the same value on every row.
  showClientColumn?: boolean;
  clientNames?: Map<string, string>;
}) {
  const t = await getTranslations("Files");

  if (documents.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/70 px-6 py-12 text-center">
        <FileText className="mx-auto size-7 text-muted-foreground/50" aria-hidden />
        <p className="mt-3 text-sm text-muted-foreground">{t("no_documents")}</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border/70">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead className="pl-4">{t("col_name")}</TableHead>
            {showClientColumn && <TableHead>{t("col_client")}</TableHead>}
            <TableHead>{t("col_type")}</TableHead>
            <TableHead>{t("col_source")}</TableHead>
            <TableHead>{t("col_status")}</TableHead>
            <TableHead className="text-right">{t("col_size")}</TableHead>
            <TableHead className="pr-4 text-right">{t("col_received")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {documents.map((doc) => (
            <TableRow key={`${doc.source}-${doc.id}`}>
              <TableCell className="max-w-[22rem] pl-4">
                <span className="flex items-center gap-2">
                  <FileText
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <span className="truncate font-medium">{doc.name}</span>
                  {doc.isDuplicate && (
                    <Badge variant="outline" className="shrink-0">
                      {t("badge_duplicate")}
                    </Badge>
                  )}
                </span>
              </TableCell>

              {showClientColumn && (
                <TableCell className="max-w-[12rem]">
                  <Link
                    href={`/files?client=${doc.clientId}`}
                    className="truncate text-sm text-primary underline-offset-4 hover:underline"
                  >
                    {clientNames?.get(doc.clientId) ?? "—"}
                  </Link>
                </TableCell>
              )}

              <TableCell>
                {doc.docType ? (
                  <Badge variant="secondary">
                    {DOC_TYPE_LABELS[doc.docType][locale].split(" — ")[0]}
                  </Badge>
                ) : doc.classificationPending ? (
                  // Mid-analysis. Distinct from "we looked and could not tell",
                  // because Move is disabled for this one and the user deserves
                  // to know it is temporary.
                  <span className="text-xs text-muted-foreground">
                    {t("analyzing")}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {t("unsorted")}
                  </span>
                )}
              </TableCell>

              <TableCell className="max-w-[16rem]">
                {doc.source === "imported" ? (
                  <Badge variant="outline">{t("badge_imported")}</Badge>
                ) : doc.engagementDeleted ? (
                  // The spec is explicit: the file still appears, but there is
                  // nothing to link to.
                  <span className="text-xs italic text-muted-foreground">
                    {t("engagement_deleted")}
                  </span>
                ) : doc.engagementId ? (
                  <Link
                    href={`/engagements/${doc.engagementId}`}
                    className="truncate text-sm text-primary underline-offset-4 hover:underline"
                  >
                    {doc.engagementTitle || t("engagement_untitled")}
                  </Link>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
                {doc.source === "final" && (
                  <Badge variant="outline" className="ml-2">
                    {t("badge_deliverable")}
                  </Badge>
                )}
              </TableCell>

              <TableCell>
                {doc.reviewStatus ? (
                  <Badge
                    variant={
                      doc.reviewStatus === "approved"
                        ? "default"
                        : doc.reviewStatus === "rejected"
                          ? "destructive"
                          : "outline"
                    }
                  >
                    {t(`status_${doc.reviewStatus}`)}
                  </Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>

              <TableCell className="text-right text-sm text-muted-foreground">
                {formatBytes(doc.sizeBytes)}
              </TableCell>

              <TableCell className="pr-4 text-right text-sm text-muted-foreground">
                {formatDate(doc.createdAt, locale, "short")}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
