"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Download, FolderOpen, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { approveItemAction, rejectItemAction } from "@/app/actions/items";
import {
  applyOverrides,
  buildPreviewDocs,
  filterDocs,
  previewCounts,
  previewHeader,
  type PreviewDoc,
  type PreviewStatus,
  type PreviewView,
} from "./preview-model";
import { PreviewCard } from "./preview-card";
import { PreviewRejectPrompt } from "./preview-reject-prompt";
import type { EngagementPreviewProps } from "./engagement-preview";

type Props = EngagementPreviewProps & { onClose: () => void };

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
  onClose,
}: Props) {
  const t = useTranslations("Preview");
  const tEng = useTranslations("Engagements");
  const [view, setView] = useState<PreviewView>("all");
  const [query, setQuery] = useState("");
  // Optimistic, in-session approve/reject, keyed by checklist item.
  const [overrides, setOverrides] = useState<Map<string, PreviewStatus>>(
    () => new Map(),
  );
  const [pendingItems, setPendingItems] = useState<Set<string>>(
    () => new Set(),
  );
  const [rejectTarget, setRejectTarget] = useState<PreviewDoc | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const docs = useMemo(
    () => applyOverrides(buildPreviewDocs(uploads, items), overrides),
    [uploads, items, overrides],
  );
  const counts = useMemo(() => previewCounts(docs), [docs]);
  const visible = useMemo(() => filterDocs(docs, view), [docs, view]);

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
      if (e.key === "Escape" && !rejectTarget) {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, rejectTarget]);

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

  const emptyMessage =
    view === "approved"
      ? t("empty_approved")
      : view === "rejected"
        ? t("empty_rejected")
        : t("empty_all");

  const overlay = (
    <div
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
        className="relative flex h-[88vh] w-[92vw] max-w-[1680px] flex-col overflow-hidden rounded-2xl border border-border/50 bg-background shadow-2xl outline-none motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-200"
      >
        {/* Header: engagement name + Download all + close */}
        <div className="flex items-start justify-between gap-3 border-b border-border/40 px-5 py-4">
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
            {counts.all > 0 && (
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
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-b border-border/40 px-5">
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
              label={t("tab_rejected")}
              count={counts.rejected}
              active={view === "rejected"}
              onClick={() => setView("rejected")}
              tone="destructive"
            />
          </div>
          <div className="relative py-2">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("search_placeholder")}
              aria-label={t("search_placeholder")}
              className="h-9 w-full rounded-lg border border-border/40 bg-card/40 pr-3 pl-8 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-border focus-visible:ring-2 focus-visible:ring-ring/60 sm:w-64"
            />
          </div>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          {visible.length === 0 ? (
            <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
              <FolderOpen className="size-8 opacity-40" />
              <p>{emptyMessage}</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8">
              {visible.map((doc) => (
                <PreviewCard
                  key={doc.fileId}
                  doc={doc}
                  locale={locale}
                  pending={pendingItems.has(doc.itemId)}
                  onApprove={() => approve(doc)}
                  onReject={() => setRejectTarget(doc)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {rejectTarget && (
        <PreviewRejectPrompt
          docHeader={previewHeader(rejectTarget, locale)}
          busy={pendingItems.has(rejectTarget.itemId)}
          onCancel={() => setRejectTarget(null)}
          onConfirm={(reason) => reject(rejectTarget, reason)}
        />
      )}
    </div>
  );

  return createPortal(overlay, document.body);
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
  tone?: "success" | "destructive";
}) {
  const countColor =
    tone === "success" && count > 0
      ? "text-success"
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
