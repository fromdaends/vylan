"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  ChevronDown,
  Download,
  FolderOpen,
  ListFilter,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { approveItemAction, rejectItemAction } from "@/app/actions/items";
import { expectedYearFromTitle } from "@/lib/ai/matching";
import {
  applyOverrides,
  buildPreviewDocs,
  filterByItem,
  filterDocs,
  groupDocsByItem,
  groupLabel,
  previewCounts,
  previewCardTitle,
  searchDocs,
  type PreviewDoc,
  type PreviewGroup,
  type PreviewStatus,
  type PreviewView,
} from "./preview-model";
import { PreviewCard } from "./preview-card";
import { PreviewRejectPrompt } from "./preview-reject-prompt";
import { PreviewDetail } from "./preview-detail";
import type { EngagementPreviewProps } from "./engagement-preview";

type Props = EngagementPreviewProps & {
  onClose: () => void;
  // When opened from a single checklist row, the overlay shows only that item's
  // documents. The engagement-wide "Download all" is hidden in that case so it
  // never implies it'll zip the whole engagement from a one-item view.
  scoped?: boolean;
};

// The focused review workspace: an ~85% overlay floating over the dimmed
// engagement page. Header (with Download all), status tabs with live counts, a
// search box, and the responsive thumbnail grid. Approve / reject / download act
// straight from the grid (optimistic), reusing the existing item actions. The
// click-in split detail lands in Phase 4; keyword search filtering in Phase 3.
export function PreviewOverlay({
  uploads,
  items,
  engagementId,
  engagementTitle,
  clientName,
  locale,
  scoped,
  onClose,
}: Props) {
  const t = useTranslations("Preview");
  const tEng = useTranslations("Engagements");
  const [view, setView] = useState<PreviewView>("all");
  const [query, setQuery] = useState("");
  // The checklist-item filter ("all" or a specific request_item id).
  const [itemFilter, setItemFilter] = useState<string>("all");
  // Optimistic, in-session approve/reject, keyed by checklist item.
  const [overrides, setOverrides] = useState<Map<string, PreviewStatus>>(
    () => new Map(),
  );
  const [pendingItems, setPendingItems] = useState<Set<string>>(
    () => new Set(),
  );
  const [rejectTarget, setRejectTarget] = useState<PreviewDoc | null>(null);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // The expected tax year, read off the engagement title (e.g. "Smith — T1
  // 2024"). Feeds the per-document request-match check inside buildPreviewDocs
  // (so a wrong-year doc shows "Flagged" in the grid, not "Looks good").
  const expectedYear = useMemo(
    () => expectedYearFromTitle(engagementTitle),
    [engagementTitle],
  );
  const docs = useMemo(
    () =>
      applyOverrides(
        buildPreviewDocs(uploads, items, { expectedYear, clientName }),
        overrides,
      ),
    [uploads, items, overrides, expectedYear, clientName],
  );
  // Search first, then the status tabs filter the search results — so the tab
  // counts + the grid both reflect the current search.
  const searched = useMemo(() => searchDocs(docs, query), [docs, query]);
  // Stable list of checklist items that have uploads, for the item-filter
  // dropdown — built from the full set (not search/tab) so the options don't
  // flicker as you type or switch tabs.
  const itemOptions = useMemo(() => groupDocsByItem(docs, items), [docs, items]);
  // The checklist-item filter applies on top of search; the tab counts + grid
  // both reflect it ("all" keeps everything).
  const itemScoped = useMemo(
    () => filterByItem(searched, itemFilter),
    [searched, itemFilter],
  );
  const counts = useMemo(() => previewCounts(itemScoped), [itemScoped]);
  const visible = useMemo(
    () => filterDocs(itemScoped, view),
    [itemScoped, view],
  );
  // Group the visible docs into one section per checklist item (in checklist
  // order). Composes with the item filter + tabs + search — only items with
  // matching docs show.
  const groups = useMemo(() => groupDocsByItem(visible, items), [visible, items]);
  const selectedDoc = useMemo(
    () =>
      selectedFileId
        ? (docs.find((d) => d.fileId === selectedFileId) ?? null)
        : null,
    [docs, selectedFileId],
  );
  const selectedFile = useMemo(
    () =>
      selectedFileId
        ? (uploads.find((u) => u.id === selectedFileId) ?? null)
        : null,
    [uploads, selectedFileId],
  );

  // Lock the page behind the overlay from scrolling and move focus into the
  // panel; restore both on close so the engagement page is exactly where the
  // accountant left it (same scroll position, focus back on the trigger).
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    const prevFocus = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus?.();
    };
  }, []);

  // Escape closes the overlay (unless the reject prompt is open — it handles its
  // own Escape/cancel first).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      // Escape peels back one layer at a time: reject prompt -> detail -> close.
      if (rejectTarget) setRejectTarget(null);
      else if (selectedFileId) setSelectedFileId(null);
      else onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, rejectTarget, selectedFileId]);

  function setItemPending(itemId: string, on: boolean) {
    setPendingItems((prev) => {
      const next = new Set(prev);
      if (on) next.add(itemId);
      else next.delete(itemId);
      return next;
    });
  }

  function clearOverride(itemId: string) {
    setOverrides((prev) => {
      const next = new Map(prev);
      next.delete(itemId);
      return next;
    });
  }

  async function approve(doc: PreviewDoc) {
    setOverrides((prev) => new Map(prev).set(doc.itemId, "approved"));
    setItemPending(doc.itemId, true);
    try {
      const fd = new FormData();
      fd.set("id", doc.itemId);
      await approveItemAction(fd);
    } catch {
      clearOverride(doc.itemId);
      toast.error(t("action_failed"));
    } finally {
      setItemPending(doc.itemId, false);
    }
  }

  async function reject(doc: PreviewDoc, reason: string) {
    setRejectTarget(null);
    setOverrides((prev) => new Map(prev).set(doc.itemId, "rejected"));
    setItemPending(doc.itemId, true);
    try {
      const fd = new FormData();
      fd.set("id", doc.itemId);
      fd.set("reason", reason);
      const res = await rejectItemAction(null, fd);
      if (res && (res.fieldErrors || res.error)) {
        throw new Error("reject_failed");
      }
    } catch {
      clearOverride(doc.itemId);
      toast.error(t("action_failed"));
    } finally {
      setItemPending(doc.itemId, false);
    }
  }

  // Trap Tab within the overlay so keyboard focus can't fall back to the dimmed
  // engagement page behind it. Skips anything inside an `inert` subtree (the
  // grid while the detail is open, the whole panel while the reject prompt is).
  function trapTab(e: React.KeyboardEvent) {
    if (e.key !== "Tab") return;
    const root = containerRef.current;
    if (!root) return;
    const focusables = Array.from(
      root.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
      ),
    ).filter(
      (el) =>
        !el.closest("[inert]") &&
        (el.offsetWidth > 0 ||
          el.offsetHeight > 0 ||
          el === document.activeElement),
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey) {
      if (active === first || !root.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last || !root.contains(active)) {
      e.preventDefault();
      first.focus();
    }
  }

  const emptyMessage = query.trim()
    ? t("empty_search")
    : view === "approved"
      ? t("empty_approved")
      : view === "flagged"
        ? t("empty_flagged")
        : view === "rejected"
          ? t("empty_rejected")
          : t("empty_all");

  const overlay = (
    <div
      ref={containerRef}
      onKeyDown={trapTab}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm motion-safe:animate-in motion-safe:fade-in-0"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`${t("eyebrow")} — ${engagementTitle}`}
        inert={rejectTarget != null || undefined}
        className="relative flex h-[88vh] w-[92vw] max-w-[1680px] flex-col overflow-hidden rounded-2xl border border-border/50 bg-background shadow-2xl outline-none motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-200"
      >
        {/* Header: engagement name + Download all + close */}
        <div
          inert={selectedDoc != null || undefined}
          className="flex items-start justify-between gap-3 border-b border-border/40 px-5 py-4"
        >
          <div className="min-w-0">
            <div className="text-[0.7rem] font-medium tracking-wide text-muted-foreground uppercase">
              {t("eyebrow")}
            </div>
            <h2 className="truncate text-lg font-semibold tracking-tight">
              {engagementTitle}
            </h2>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {clientName ? `${clientName} · ` : ""}
              {t("doc_count", { count: counts.all })}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {!scoped && counts.all > 0 && (
              <a
                href={`/api/engagements/${engagementId}/files.zip`}
                className="inline-flex"
                download
              >
                <Button type="button" variant="outline" size="sm">
                  <Download className="size-4" />
                  {tEng("download_all")}
                </Button>
              </a>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("close")}
              onClick={onClose}
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>

        {/* Tabs + search */}
        <div
          inert={selectedDoc != null || undefined}
          className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-b border-border/40 px-5"
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {itemOptions.length > 1 && (
              <>
                <PreviewItemFilter
                  options={itemOptions}
                  value={itemFilter}
                  onChange={setItemFilter}
                  locale={locale}
                />
                <span
                  aria-hidden
                  className="hidden h-5 w-px bg-border/50 sm:block"
                />
              </>
            )}
            <div className="flex items-center gap-5">
              <PreviewTab
                label={t("tab_all")}
                count={counts.all}
                active={view === "all"}
                onClick={() => setView("all")}
              />
              <PreviewTab
                label={t("tab_approved")}
                count={counts.approved}
                active={view === "approved"}
                onClick={() => setView("approved")}
                tone="success"
              />
              <PreviewTab
                label={t("tab_flagged")}
                count={counts.flagged}
                active={view === "flagged"}
                onClick={() => setView("flagged")}
                tone="warning"
              />
              <PreviewTab
                label={t("tab_rejected")}
                count={counts.rejected}
                active={view === "rejected"}
                onClick={() => setView("rejected")}
                tone="destructive"
              />
            </div>
          </div>
          <div className="relative py-2">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("search_placeholder")}
              aria-label={t("search_placeholder")}
              className="h-9 w-full rounded-lg border border-border/40 bg-card/40 pr-8 pl-8 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-border focus-visible:ring-2 focus-visible:ring-ring/60 sm:w-72"
            />
            {query && (
              <button
                type="button"
                aria-label={t("clear_search")}
                onClick={() => setQuery("")}
                className="absolute top-1/2 right-1.5 inline-flex size-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Grid */}
        <div
          inert={selectedDoc != null || undefined}
          className="flex-1 overflow-y-auto px-5 py-5"
        >
          {visible.length === 0 ? (
            <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
              <FolderOpen className="size-8 opacity-40" />
              <p>{emptyMessage}</p>
            </div>
          ) : (
            <div className="space-y-7">
              {groups.map((g) => (
                <section key={g.itemId} aria-label={groupLabel(g, locale)}>
                  {/* Section header — the checklist item these documents belong
                      to. Hairline divider, not a box (mesh, don't box). */}
                  <div className="mb-3 flex items-baseline gap-2 border-b border-border/30 pb-2">
                    <h3 className="truncate text-sm font-semibold tracking-tight text-foreground">
                      {groupLabel(g, locale)}
                    </h3>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {t("doc_count", { count: g.docs.length })}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8">
                    {g.docs.map((doc) => (
                      <PreviewCard
                        key={doc.fileId}
                        doc={doc}
                        locale={locale}
                        pending={pendingItems.has(doc.itemId)}
                        onOpen={() => setSelectedFileId(doc.fileId)}
                        onApprove={() => approve(doc)}
                        onReject={() => setRejectTarget(doc)}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>

        {selectedDoc && selectedFile && (
          <PreviewDetail
            doc={selectedDoc}
            file={selectedFile}
            expectedDocType={
              items.find((i) => i.id === selectedDoc.itemId)?.doc_type ??
              "other"
            }
            expectedYear={expectedYear}
            clientName={clientName}
            locale={locale}
            pending={pendingItems.has(selectedDoc.itemId)}
            onApprove={() => approve(selectedDoc)}
            onReject={() => setRejectTarget(selectedDoc)}
            onBack={() => {
              setSelectedFileId(null);
              panelRef.current?.focus();
            }}
            onCloseOverlay={onClose}
          />
        )}
      </div>

      {rejectTarget && (
        <PreviewRejectPrompt
          docHeader={previewCardTitle(rejectTarget, locale)}
          busy={pendingItems.has(rejectTarget.itemId)}
          onCancel={() => setRejectTarget(null)}
          onConfirm={(reason) => reject(rejectTarget, reason)}
        />
      )}
    </div>
  );

  return createPortal(overlay, document.body);
}

// The checklist-item filter — a native <select> (no portal, so it never fights
// the overlay's stacking context the way a popover would, and it gets free
// keyboard + mobile behaviour). Styled minimal to match the meshed look:
// transparent, hairless, an icon on each side.
function PreviewItemFilter({
  options,
  value,
  onChange,
  locale,
}: {
  options: PreviewGroup[];
  value: string;
  onChange: (v: string) => void;
  locale: string;
}) {
  const t = useTranslations("Preview");
  return (
    <div className="relative inline-flex items-center">
      <ListFilter className="pointer-events-none absolute left-2 size-4 text-muted-foreground" />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={t("filter_by_item")}
        className="max-w-[14rem] cursor-pointer appearance-none truncate rounded-md bg-transparent py-2 pr-7 pl-8 text-sm font-medium text-foreground outline-none transition-colors hover:bg-secondary/60 focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <option value="all">{t("filter_all_items")}</option>
        {options.map((g) => (
          <option key={g.itemId} value={g.itemId}>
            {groupLabel(g, locale)}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-1.5 size-4 text-muted-foreground" />
    </div>
  );
}

function PreviewTab({
  label,
  count,
  active,
  onClick,
  tone,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  tone?: "success" | "warning" | "destructive";
}) {
  const countColor =
    tone === "success" && count > 0
      ? "text-success"
      : tone === "warning" && count > 0
        ? "text-warning"
        : tone === "destructive" && count > 0
          ? "text-destructive"
          : active
            ? "text-foreground"
            : "text-muted-foreground";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "-mb-px flex cursor-pointer items-center gap-1.5 border-b-2 py-3 text-sm font-medium transition-colors",
        active
          ? "border-foreground text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
      <span
        className={cn(
          "rounded-full px-1.5 py-0.5 text-xs tabular-nums",
          active ? "bg-muted" : "bg-muted/60",
          countColor,
        )}
      >
        {count}
      </span>
    </button>
  );
}
