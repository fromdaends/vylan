"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { Sparkles, X } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/cn";
import {
  closeAssistant,
  getAssistantServerSnapshot,
  getAssistantState,
  openAssistant,
  openAssistantOnPageEngagement,
  setAssistantTab,
  setSelectedEngagement,
  subscribeAssistant,
  type AssistantTab,
} from "@/components/assistant/assistant-store";
import {
  clampPanelWidth,
  clearStoredPanelWidth,
  defaultPanelWidth,
  isFreshEngagement,
  markEngagementSeen,
  PANEL_MAX_FRACTION,
  PANEL_MIN_WIDTH_PX,
  readSeenEngagements,
  readStoredPanelWidth,
  storePanelWidth,
} from "@/components/assistant/assistant-prefs";
import { EngagementSelector } from "@/components/assistant/engagement-selector";
import { ChatTab } from "@/components/assistant/chat-tab";
import { ActivityTab } from "@/components/assistant/activity-tab";

// The Vylan Assistant panel — the evolution of the old "Ask Vylan" help
// sheet. A NON-modal, resizable slide-in fixed to the right edge: the page
// behind stays fully usable (no dimming overlay, no scroll lock), the surface
// is the elevated card color so it reads as a separate layer in both themes,
// and the accountant drags the left edge to resize (double-click resets).
//
// z-index: 45 — above the page chrome (mobile tab bar z-40, sidebar z-30) and
// below every popover/dialog/dropdown (z-50), so the engagement selector's
// popover and any dialogs stack correctly over the panel.
export function AssistantPanel({
  locale,
  userDisplayName,
  userId,
}: {
  locale: "en" | "fr";
  userDisplayName: string;
  userId: string;
}) {
  const t = useTranslations("Assistant");
  const tHelp = useTranslations("Help");
  const tc = useTranslations("Common");
  const { open, tab, pageEngagement, selected } = useSyncExternalStore(
    subscribeAssistant,
    getAssistantState,
    getAssistantServerSnapshot,
  );

  const panelRef = useRef<HTMLElement | null>(null);
  const fabRef = useRef<HTMLButtonElement | null>(null);
  const wasOpenRef = useRef(false);

  // -------------------------------------------------------------------------
  // FAB badge — a quiet dot inviting the accountant in on a fresh engagement
  // they haven't opened the panel for yet. Recomputed in a frame callback
  // (never during render) so Date.now() stays out of the render path.
  // -------------------------------------------------------------------------
  const [badge, setBadge] = useState(false);
  useEffect(() => {
    let frame: number | null = null;
    if (!pageEngagement || open) {
      frame = requestAnimationFrame(() => setBadge(false));
    } else {
      const pe = pageEngagement;
      frame = requestAnimationFrame(() => {
        const fresh = isFreshEngagement(pe.status, pe.createdAt, Date.now());
        const seen = readSeenEngagements(userId).includes(pe.id);
        setBadge(fresh && !seen);
      });
    }
    return () => {
      if (frame != null) cancelAnimationFrame(frame);
    };
  }, [pageEngagement, open, userId]);

  // On open: focus the panel (so Esc + keyboard flow land here) and mark the
  // page's engagement as seen (clears the invitation badge for good). On
  // close: hand focus back to the FAB, matching what the old Radix Sheet did
  // by restoring focus to its trigger — otherwise keyboard focus drops to
  // <body>. All external-system writes, which is what effects are for.
  useEffect(() => {
    if (open) {
      panelRef.current?.focus();
      const pe = getAssistantState().pageEngagement;
      if (pe) markEngagementSeen(userId, pe.id);
    } else if (wasOpenRef.current) {
      fabRef.current?.focus();
    }
    wasOpenRef.current = open;
  }, [open, userId]);

  // -------------------------------------------------------------------------
  // Legacy + new open events. The profile dropdown / mobile account menu
  // still dispatch "vylan:open-help"; engagement pages dispatch
  // "vylan:assistant:open" with an optional target tab.
  // -------------------------------------------------------------------------
  useEffect(() => {
    function onOpenHelp() {
      openAssistant("chat");
    }
    function onOpenAssistant(e: Event) {
      const detail = (e as CustomEvent).detail as
        | { tab?: AssistantTab; scopeToPage?: boolean }
        | undefined;
      // scopeToPage (the engagement page's Activity triggers): rescope to the
      // current page's engagement even when the panel is already open —
      // the user explicitly asked for THIS engagement.
      if (detail?.scopeToPage) {
        openAssistantOnPageEngagement(detail?.tab ?? "chat");
      } else {
        openAssistant(detail?.tab ?? "chat");
      }
    }
    window.addEventListener("vylan:open-help", onOpenHelp);
    window.addEventListener("vylan:assistant:open", onOpenAssistant);
    return () => {
      window.removeEventListener("vylan:open-help", onOpenHelp);
      window.removeEventListener("vylan:assistant:open", onOpenAssistant);
    };
  }, []);

  // -------------------------------------------------------------------------
  // Width: default 35% of the viewport, clamped to [400px, 60vw], persisted
  // per user, drag handle on the left edge, double-click resets. Desktop
  // behavior only — below the sm breakpoint the panel is full-width via CSS.
  // -------------------------------------------------------------------------
  const [width, setWidth] = useState<number | null>(null);
  // Viewport width mirror — only used to expose the separator's dynamic
  // aria-valuemax; updated alongside width.
  const [viewportW, setViewportW] = useState<number | null>(null);
  const widthRef = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);

  const applyWidth = useCallback((px: number) => {
    widthRef.current = px;
    setWidth(px);
  }, []);

  // Initial width after mount (localStorage + viewport are browser-only).
  // Scheduled in a frame callback rather than set synchronously in the
  // effect body — until it lands, CSS falls back to the same 35vw default.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const vw = window.innerWidth;
      const stored = readStoredPanelWidth(userId);
      setViewportW(vw);
      applyWidth(
        stored != null ? clampPanelWidth(stored, vw) : defaultPanelWidth(vw),
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [userId, applyWidth]);

  // Keep the width within bounds when the window resizes.
  useEffect(() => {
    function onResize() {
      setViewportW(window.innerWidth);
      const current = widthRef.current;
      if (current == null) return;
      applyWidth(clampPanelWidth(current, window.innerWidth));
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [applyWidth]);

  const onHandlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    draggingRef.current = true;
    setDragging(true);
  }, []);

  const onHandlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current) return;
      const vw = window.innerWidth;
      applyWidth(clampPanelWidth(vw - e.clientX, vw));
    },
    [applyWidth],
  );

  const endDrag = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setDragging(false);
      try {
        (e.target as Element).releasePointerCapture(e.pointerId);
      } catch {
        // Capture already released — fine.
      }
      if (widthRef.current != null) storePanelWidth(userId, widthRef.current);
    },
    [userId],
  );

  const resetWidth = useCallback(() => {
    clearStoredPanelWidth(userId);
    applyWidth(defaultPanelWidth(window.innerWidth));
  }, [userId, applyWidth]);

  // Keyboard resize for the handle: arrows nudge by 24px; Home/End jump to
  // the widest/narrowest allowed. The handle sits on the LEFT edge, so
  // ArrowLeft widens and ArrowRight narrows.
  const onHandleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const STEP = 24;
      const current = widthRef.current ?? 0;
      let next: number | null = null;
      if (e.key === "ArrowLeft") {
        next = current + STEP;
      } else if (e.key === "ArrowRight") {
        next = current - STEP;
      } else if (e.key === "Home") {
        next = Number.POSITIVE_INFINITY; // clamps to max
      } else if (e.key === "End") {
        next = 0; // clamps to min
      } else {
        return;
      }
      e.preventDefault();
      const clamped = clampPanelWidth(next, window.innerWidth);
      applyWidth(clamped);
      storePanelWidth(userId, clamped);
    },
    [userId, applyWidth],
  );

  // While dragging: kill text selection page-wide and show the col-resize
  // cursor everywhere so fast drags don't flicker.
  useEffect(() => {
    if (!dragging) return;
    const prevUserSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    return () => {
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
    };
  }, [dragging]);

  return (
    <>
      {/* Floating "Ask Vylan" button — hidden while the panel is open. */}
      {!open && (
        <motion.button
          ref={fabRef}
          type="button"
          whileHover={{ scale: 1.04, y: -1 }}
          whileTap={{ scale: 0.97 }}
          transition={{ type: "spring", stiffness: 400, damping: 28 }}
          onClick={() => openAssistant()}
          className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] sm:bottom-6 right-4 sm:right-6 z-50 group inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-[0_10px_30px_-10px_rgba(0,0,0,0.45)] ring-1 ring-black/5 dark:ring-white/5 hover:shadow-[0_16px_40px_-12px_rgba(0,0,0,0.5)] transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          // aria-label supersedes name-from-contents, so the badge has to be
          // folded in here for screen readers to hear the invitation.
          aria-label={
            badge
              ? `${tHelp("open_help")} (${t("new_engagement_badge")})`
              : tHelp("open_help")
          }
        >
          <span className="relative inline-flex items-center justify-center">
            <span
              aria-hidden
              className="absolute inset-0 -m-1 rounded-full bg-accent/40 blur-md opacity-0 group-hover:opacity-100 transition-opacity"
            />
            <Sparkles className="relative size-4" aria-hidden />
          </span>
          <span>{tHelp("ai_button")}</span>
          {badge && (
            <span
              className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-accent ring-2 ring-background"
              aria-hidden
            />
          )}
        </motion.button>
      )}

      {/* The panel. Kept mounted so chat state survives close/reopen (same
          behavior the old Sheet gave us); `inert` blocks focus/interaction
          while closed. Surface = bg-card (the elevated card color), NOT the
          page background — the panel must read as a layer on top of the page
          in both themes, per the founder spec. */}
      <aside
        ref={panelRef}
        inert={!open}
        aria-hidden={!open}
        role="complementary"
        aria-label={t("panel_title")}
        tabIndex={-1}
        onKeyDown={(e) => {
          // defaultPrevented guard: a Radix layer inside the panel (the
          // engagement-selector popover, a dropdown…) handles its own Escape
          // and preventDefault()s it — that press must dismiss only that
          // layer, not the whole panel.
          if (e.key === "Escape" && !e.defaultPrevented) closeAssistant();
        }}
        style={
          {
            "--assistant-w": width != null ? `${width}px` : "35vw",
          } as CSSProperties
        }
        className={cn(
          "fixed inset-y-0 right-0 z-[45] flex flex-col outline-none",
          "bg-card text-card-foreground border-l border-border/60",
          "shadow-[-12px_0_40px_-16px_rgba(0,0,0,0.35)]",
          "w-full sm:w-[var(--assistant-w)]",
          dragging
            ? "transition-none"
            : "transition-transform duration-300 ease-out",
          open ? "translate-x-0" : "translate-x-full pointer-events-none",
        )}
      >
        {/* Drag handle — desktop only (mobile is full-width). */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t("resize_handle")}
          // A focusable separator is an ARIA window splitter and must expose
          // its position (axe aria-required-attr).
          aria-valuenow={width ?? undefined}
          aria-valuemin={PANEL_MIN_WIDTH_PX}
          aria-valuemax={
            viewportW != null
              ? Math.round(
                  Math.max(PANEL_MIN_WIDTH_PX, viewportW * PANEL_MAX_FRACTION),
                )
              : undefined
          }
          title={t("resize_hint")}
          tabIndex={0}
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={resetWidth}
          onKeyDown={onHandleKeyDown}
          className="group absolute inset-y-0 left-0 z-10 hidden w-2 -ml-1 cursor-col-resize touch-none items-center justify-center sm:flex focus-visible:outline-none"
        >
          <div
            aria-hidden
            className={cn(
              "h-12 w-1 rounded-full transition-opacity",
              dragging
                ? "bg-accent opacity-100"
                : "bg-border opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 group-focus-visible:bg-accent",
            )}
          />
        </div>

        {/* Header: brand chip + engagement selector + close. */}
        <header className="flex items-center gap-2.5 px-4 py-3 border-b border-border/40 bg-gradient-to-b from-accent/[0.03] to-transparent">
          <div
            aria-hidden
            className="shrink-0 size-8 rounded-full bg-gradient-to-br from-accent/20 to-accent/5 flex items-center justify-center ring-1 ring-accent/20"
          >
            <Sparkles className="size-4 text-accent" aria-hidden />
          </div>
          <EngagementSelector
            value={selected}
            onChange={setSelectedEngagement}
          />
          <button
            type="button"
            onClick={closeAssistant}
            className="shrink-0 inline-flex items-center justify-center size-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
            aria-label={tc("close")}
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>

        {/* Tabs: Chat | Activity. Both contents stay mounted (forceMount) so
            chat history and the activity feed survive tab switches. */}
        <Tabs
          value={tab}
          onValueChange={(v) => setAssistantTab(v as AssistantTab)}
          className="flex-1 min-h-0 flex flex-col gap-0"
        >
          <div className="px-4 pt-1.5 pb-[5px] border-b border-border/40">
            <TabsList variant="line">
              <TabsTrigger value="chat">{t("tab_chat")}</TabsTrigger>
              <TabsTrigger value="activity">{t("tab_activity")}</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent
            value="chat"
            forceMount
            className="flex-1 min-h-0 flex flex-col data-[state=inactive]:hidden"
          >
            <ChatTab locale={locale} userDisplayName={userDisplayName} />
          </TabsContent>
          <TabsContent
            value="activity"
            forceMount
            className="flex-1 min-h-0 overflow-y-auto overscroll-contain data-[state=inactive]:hidden"
          >
            <ActivityTab
              engagementId={selected?.id ?? null}
              locale={locale}
              active={open && tab === "activity"}
            />
          </TabsContent>
        </Tabs>
      </aside>
    </>
  );
}
