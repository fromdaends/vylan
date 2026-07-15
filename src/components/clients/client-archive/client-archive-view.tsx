"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Search,
  ArrowUpDown,
  FileText,
  ListChecks,
  PenLine,
  FileCheck2,
  FolderOpen,
  Download,
  ChevronsDownUp,
  ChevronsUpDown,
  type LucideIcon,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDate, formatBytes, type AppLocale } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { ClientArchive, ArchiveCategoryKey, ArchiveFile } from "@/lib/db/client-archive";
import { ArchiveEngagementSection } from "./engagement-section";
import { ArchiveDownloadZipButton } from "./download-zip-button";
import {
  filterAndSortArchive,
  ARCHIVE_SORT_OPTIONS,
  ARCHIVE_CATEGORY_FILTERS,
  type ArchiveSortKey,
  type ArchiveCategoryFilter,
} from "./archive-filter";

const CATEGORY_ICON: Record<ArchiveCategoryKey, LucideIcon> = {
  checklist: ListChecks,
  signed: PenLine,
  final: FileCheck2,
};

// Interactive browse surface for one client's archive: live search + sort +
// category filter + expand/collapse-all, all in-memory against the archive the
// server already fetched (mirrors the clients list — no server round-trip, no
// debounce). The section open state is lifted here so search can auto-expand
// matches and the expand/collapse-all button can drive every section at once.
export function ClientArchiveView({
  archive,
  locale,
}: {
  archive: ClientArchive;
  locale: AppLocale;
}) {
  const t = useTranslations("Archive");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<ArchiveSortKey>("newest");
  const [category, setCategory] = useState<ArchiveCategoryFilter>("all");
  // Seed with the most recent engagement open (matches the pre-search default);
  // the rest start collapsed so a long history reads as a calm list.
  const [openIds, setOpenIds] = useState<Set<string>>(
    () => new Set(archive.engagements[0] ? [archive.engagements[0].id] : []),
  );

  const filtered = useMemo(
    () => filterAndSortArchive(archive.engagements, { query, category, sort, locale }),
    [archive.engagements, query, category, sort, locale],
  );

  const searching = query.trim() !== "";
  // While searching, force every matching engagement open so results are visible.
  const isOpen = (id: string) => (searching ? true : openIds.has(id));
  const toggle = (id: string) => {
    // Sections are force-open during search; ignore header toggles then so we
    // don't silently rewrite the user's pre-search expand/collapse state.
    if (searching) return;
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const allOpen =
    filtered.engagements.length > 0 && filtered.engagements.every((e) => openIds.has(e.id));
  // Expand/collapse only the currently VISIBLE engagements, preserving the
  // open/closed state of any hidden by the active category filter.
  const toggleAll = () =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      for (const e of filtered.engagements) {
        if (allOpen) next.delete(e.id);
        else next.add(e.id);
      }
      return next;
    });

  if (archive.totalFiles === 0) {
    return <ArchiveEmpty icon={FolderOpen} message={t("empty")} />;
  }

  const categoryLabel: Record<ArchiveCategoryKey, string> = {
    checklist: t("cat_checklist"),
    signed: t("cat_signed"),
    final: t("cat_final"),
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-xs">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("search_placeholder")}
              aria-label={t("search_label")}
              className="pl-8"
            />
          </div>
          <div className="flex items-center gap-2">
            <Select value={sort} onValueChange={(v) => setSort(v as ArchiveSortKey)}>
              <SelectTrigger size="sm" className="w-[168px]" aria-label={t("sort_label")}>
                <ArrowUpDown className="size-4 text-muted-foreground" aria-hidden />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ARCHIVE_SORT_OPTIONS.map((opt) => (
                  <SelectItem key={opt} value={opt}>
                    {t(`sort_${opt}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!searching && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={toggleAll}
                aria-label={allOpen ? t("collapse_all") : t("expand_all")}
              >
                {allOpen ? (
                  <ChevronsDownUp className="size-4" />
                ) : (
                  <ChevronsUpDown className="size-4" />
                )}
                <span className="hidden sm:inline">
                  {allOpen ? t("collapse_all") : t("expand_all")}
                </span>
              </Button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div role="group" aria-label={t("filter_label")} className="flex items-center gap-1">
            {ARCHIVE_CATEGORY_FILTERS.map((f) => {
              const active = category === f;
              return (
                <button
                  key={f}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setCategory(f)}
                  className={cn(
                    "cursor-pointer rounded-md px-2.5 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "bg-secondary font-medium text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t(`filter_${f}`)}
                </button>
              );
            })}
          </div>
          <span className="text-xs text-muted-foreground">
            {t("total_files", { count: filtered.matchedFiles })}
          </span>
        </div>
      </div>

      {/* List */}
      {filtered.engagements.length === 0 ? (
        <ArchiveEmpty icon={Search} message={t("no_results")} />
      ) : (
        <div className="space-y-3">
          {filtered.engagements.map((eng) => (
            <ArchiveEngagementSection
              key={eng.id}
              title={eng.title}
              meta={`${eng.type.toUpperCase()} · ${formatDate(eng.createdAt, locale, "medium")}`}
              countLabel={t("file_count", { count: eng.fileCount })}
              archivedLabel={t("archived")}
              archived={eng.archived}
              open={isOpen(eng.id)}
              onOpenChange={() => toggle(eng.id)}
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
              <div className="space-y-5">
                {eng.categories.map((group) => {
                  const Icon = CATEGORY_ICON[group.key];
                  return (
                    <section key={group.key} className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Icon className="size-4 text-muted-foreground" />
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {categoryLabel[group.key]}
                        </h3>
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
                          />
                        ))}
                      </ul>
                    </section>
                  );
                })}
              </div>
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
}: {
  file: ArchiveFile;
  clientId: string;
  locale: AppLocale;
}) {
  const t = useTranslations("Archive");
  const chip = fileChip(file);
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
            {t(chip.key)}
          </Badge>
        )}
        {/* The route streams the bytes with an attachment disposition, so a plain
            anchor downloads without navigating the page away. */}
        <Button asChild variant="ghost" size="icon-sm" aria-label={t("download")}>
          <a href={`/api/clients/${clientId}/archive/file/${file.category}/${file.id}?download=1`}>
            <Download className="size-4" />
          </a>
        </Button>
      </div>
    </li>
  );
}

function fileChip(file: ArchiveFile): { key: string; tone: "muted" | "danger" } | null {
  if (file.category === "signed") return { key: "status_signed", tone: "muted" };
  if (file.category === "final") return { key: "status_final", tone: "muted" };
  if (file.status === "rejected") return { key: "status_rejected", tone: "danger" };
  if (file.status === "approved") return { key: "status_approved", tone: "muted" };
  if (file.status === "pending") return { key: "status_pending", tone: "muted" };
  return null;
}

function ArchiveEmpty({ icon: Icon, message }: { icon: LucideIcon; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card/30 px-6 py-16 text-center">
      <Icon className="size-8 text-muted-foreground/60" />
      <p className="max-w-sm text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
