import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  FileText,
  ListChecks,
  PenLine,
  FileCheck2,
  FolderOpen,
  Download,
  type LucideIcon,
} from "lucide-react";
import { getClientArchive, type ArchiveCategoryKey, type ArchiveFile } from "@/lib/db/client-archive";
import { assertLocale } from "@/lib/locale";
import { formatDate, formatBytes, type AppLocale } from "@/lib/format";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArchiveEngagementSection } from "@/components/clients/client-archive/engagement-section";
import { ArchiveDownloadZipButton } from "@/components/clients/client-archive/download-zip-button";
import { cn } from "@/lib/cn";

// The archive reads live document data, so never serve a stale snapshot after a
// new upload / deliverable / signature.
export const dynamic = "force-dynamic";

const CATEGORY_ICON: Record<ArchiveCategoryKey, LucideIcon> = {
  checklist: ListChecks,
  signed: PenLine,
  final: FileCheck2,
};

export default async function ClientArchivePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const archive = await getClientArchive(id, locale);
  if (!archive) notFound();

  const t = await getTranslations("Archive");
  const tApp = await getTranslations("App");
  const tCommon = await getTranslations("Common");

  const categoryLabel: Record<ArchiveCategoryKey, string> = {
    checklist: t("cat_checklist"),
    signed: t("cat_signed"),
    final: t("cat_final"),
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Breadcrumb
        label={tCommon("breadcrumb")}
        items={[
          { label: tApp("nav_clients"), href: "/clients" },
          {
            label: archive.client.displayName,
            href: `/clients/${archive.client.id}`,
          },
          { label: t("title") },
        ]}
      />

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <FileText className="size-5 text-muted-foreground" />
            <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          </div>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
          <p className="pt-1 text-sm text-foreground">
            <span className="font-medium">{archive.client.displayName}</span>
            <span className="text-muted-foreground">
              {" · "}
              {t("total_files", { count: archive.totalFiles })}
            </span>
          </p>
        </div>
        {archive.totalFiles > 0 && (
          <ArchiveDownloadZipButton
            endpoint={`/api/clients/${archive.client.id}/archive`}
            label={t("download_everything")}
            preparingLabel={t("preparing")}
            emptyLabel={t("download_empty")}
            failedLabel={t("download_failed")}
            tooLargeLabel={t("download_too_large")}
            variant="default"
          />
        )}
      </header>

      {archive.engagements.length === 0 || archive.totalFiles === 0 ? (
        <EmptyState icon={FolderOpen} message={t("empty")} />
      ) : (
        <div className="space-y-3">
          {archive.engagements.map((eng, index) => (
            <ArchiveEngagementSection
              key={eng.id}
              title={eng.title}
              meta={`${eng.type.toUpperCase()} · ${formatDate(eng.createdAt, locale, "medium")}`}
              countLabel={t("file_count", { count: eng.fileCount })}
              archivedLabel={t("archived")}
              archived={eng.archived}
              // Open the most recent engagement; collapse the rest so a long
              // history reads as a calm list of headers.
              defaultOpen={index === 0}
              headerAction={
                <ArchiveDownloadZipButton
                  endpoint={`/api/clients/${archive.client.id}/archive/engagement/${eng.id}`}
                  label={t("download")}
                  preparingLabel={t("preparing")}
                  emptyLabel={t("download_empty")}
                  failedLabel={t("download_failed")}
                />
              }
            >
              {eng.categories.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("empty_engagement")}
                </p>
              ) : (
                <div className="space-y-5">
                  {eng.categories.map((group) => {
                    const Icon = CATEGORY_ICON[group.key];
                    return (
                      <section key={group.key} className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Icon className="size-4 text-muted-foreground" />
                          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {categoryLabel[group.key]}
                          </h2>
                          <span className="text-xs text-muted-foreground">
                            ({group.files.length})
                          </span>
                        </div>
                        <ul className="space-y-0.5">
                          {group.files.map((file) => (
                            <FileRow
                              key={`${file.category}-${file.id}`}
                              file={file}
                              clientId={archive.client.id}
                              locale={locale}
                              t={t}
                            />
                          ))}
                        </ul>
                      </section>
                    );
                  })}
                </div>
              )}
            </ArchiveEngagementSection>
          ))}
        </div>
      )}
    </div>
  );
}

function FileRow({
  file,
  clientId,
  locale,
  t,
}: {
  file: ArchiveFile;
  clientId: string;
  locale: AppLocale;
  t: (key: string) => string;
}) {
  const chip = statusChip(file, t);
  const dateLine =
    formatDate(file.date, locale, "medium") +
    (file.sizeBytes ? ` · ${formatBytes(file.sizeBytes)}` : "");
  return (
    <li className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-secondary/40">
      <div className="flex min-w-0 items-center gap-2.5">
        <FileText className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <div className="truncate text-sm text-foreground">{file.name}</div>
          <div className="text-xs text-muted-foreground">{dateLine}</div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {chip && (
          <Badge
            variant="outline"
            className={cn(
              "text-[11px]",
              chip.tone === "danger"
                ? "border-destructive/40 text-destructive"
                : "text-muted-foreground",
            )}
          >
            {chip.label}
          </Badge>
        )}
        {/* The route streams the bytes with an attachment disposition, so a
            plain anchor downloads without navigating the page away. */}
        <Button asChild variant="ghost" size="icon-sm" aria-label={t("download")}>
          <a
            href={`/api/clients/${clientId}/archive/file/${file.category}/${file.id}?download=1`}
          >
            <Download className="size-4" />
          </a>
        </Button>
      </div>
    </li>
  );
}

function statusChip(
  file: ArchiveFile,
  t: (key: string) => string,
): { label: string; tone: "muted" | "danger" } | null {
  if (file.category === "signed") return { label: t("status_signed"), tone: "muted" };
  if (file.category === "final") return { label: t("status_final"), tone: "muted" };
  // Checklist: surface the accountant's review verdict.
  if (file.status === "rejected") return { label: t("status_rejected"), tone: "danger" };
  if (file.status === "approved") return { label: t("status_approved"), tone: "muted" };
  if (file.status === "pending") return { label: t("status_pending"), tone: "muted" };
  return null;
}

function EmptyState({ icon: Icon, message }: { icon: LucideIcon; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card/30 px-6 py-16 text-center">
      <Icon className="size-8 text-muted-foreground/60" />
      <p className="max-w-sm text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
