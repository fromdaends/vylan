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
import {
  History,
  Info,
  MessageSquare,
  MessagesSquare,
  Settings,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import {
  closeAssistant,
  getAssistantServerSnapshot,
  getAssistantState,
  openAssistant,
  openAssistantForEngagement,
  openAssistantOnPageEngagement,
  setAssistantTab,
  setSelectedEngagement,
  subscribeAssistant,
  type AssistantTab,
  type EngagementOption,
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
import { ClientMessagesTab } from "@/components/assistant/client-messages-tab";
import { AssistantInfo } from "@/components/assistant/assistant-info";

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
  userId,
}: {
  locale: "en" | "fr";
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
  // The capabilities overlay (header Info button). Reset to closed on every
  // fresh open so the panel never reopens onto the info screen.
  const [infoOpen, setInfoOpen] = useState(false);
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
        // Unread client messages also light the dot — the Messages surface
        // now lives inside this panel, so the FAB is its doorway.
        setBadge((fresh && !seen) || (pe.messagesUnread ?? 0) > 0);
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

  // Fresh open always lands on the chat/activity view, never the info
  // overlay. Scheduled in a frame callback so the effect body stays free of
  // synchronous state writes (matches the chat-tab view reset).
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => setInfoOpen(false));
    return () => cancelAnimationFrame(frame);
  }, [open]);

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
        | {
            tab?: AssistantTab;
            scopeToPage?: boolean;
            engagement?: EngagementOption;
          }
        | undefined;
      // An explicit engagement (a notification's Reply row) wins outright:
      // open scoped to it, whatever page we're on.
      if (detail?.engagement) {
        openAssistantForEngagement(detail.engagement, detail?.tab ?? "chat");
        return;
      }
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

  // Desktop split-workspace contract: publish the panel's live width as a
  // root CSS variable so AppShell can shrink its main column instead of
  // letting the assistant cover it. The extra 16px accounts for the panel's
  // right inset and the breathing room between the two surfaces.
  useEffect(() => {
    const panelWidth = width ?? defaultPanelWidth(window.innerWidth);
    document.documentElement.style.setProperty(
      "--assistant-shell-offset",
      open ? `${panelWidth + 16}px` : "0px",
    );
  }, [open, width]);

  useEffect(() => {
    return () => {
      document.documentElement.style.removeProperty("--assistant-shell-offset");
    };
  }, []);

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
            {/* Neutral multi-bubble icon, not sparkles: the panel is now the
                home of CLIENT messages + AI chat + activity, so the doorway
                can't read as AI-only (founder rename). */}
            <MessagesSquare className="relative size-4" aria-hidden />
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
          // layer, not the whole panel. Otherwise Escape closes the info
          // overlay first (if open), then the panel.
          if (e.key === "Escape" && !e.defaultPrevented) {
            if (infoOpen) setInfoOpen(false);
            else closeAssistant();
          }
        }}
        style={
          {
            "--assistant-w": width != null ? `${width}px` : "35vw",
          } as CSSProperties
        }
        className={cn(
          // The assistant is an intentionally black surface in both app
          // themes. Scope dark semantic color tokens to the panel so
          // text-foreground/text-muted-foreground remain legible when the
          // surrounding app is using light mode.
          "dark fixed inset-y-0 right-0 z-[45] flex w-full flex-col overflow-hidden bg-black text-white outline-none",
          "sm:inset-y-2 sm:right-2 sm:w-[var(--assistant-w)] sm:rounded-2xl sm:border sm:border-white/10",
          "sm:shadow-[-18px_0_48px_-28px_rgba(0,0,0,0.75),0_18px_50px_-30px_rgba(0,0,0,0.8)]",
          dragging
            ? "transition-none"
            : "transition-transform duration-300 ease-out",
          // display:none while closed prevents the off-canvas surface and its
          // wide shadow from leaving a dark strip at the viewport edge. The
          // panel remains mounted, so its chat state is still preserved.
          open ? "translate-x-0" : "hidden pointer-events-none",
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

        {/* Header: engagement selector (subtle) + info + settings + close.
            The old kebab view-menu is gone (founder) — views are the tab
            strip right below. */}
        <header className="flex items-center gap-1 bg-[#11110f] px-3 pt-2.5 pb-1">
          <EngagementSelector
            value={selected}
            onChange={setSelectedEngagement}
          />
          {/* Info: expands the capabilities overlay over the panel body. */}
          <button
            type="button"
            onClick={() => setInfoOpen((v) => !v)}
            aria-label={t("info_label")}
            aria-expanded={infoOpen}
            className={cn(
              "shrink-0 inline-flex items-center justify-center size-8 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              infoOpen
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/60",
            )}
          >
            <Info className="size-4" aria-hidden />
          </button>
          {/* Gear → the assistant's settings (replaces the kebab, founder). */}
          <Link
            href="/settings?tab=assistant"
            aria-label={t("settings_label")}
            className="shrink-0 inline-flex items-center justify-center size-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
          >
            <Settings className="size-4" aria-hidden />
          </Link>
          <button
            type="button"
            onClick={closeAssistant}
            className="shrink-0 inline-flex items-center justify-center size-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
            aria-label={tc("close")}
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>

        {/* Browser-style connected tabs (founder): rounded tops, the active
            tab shares the content's background so it visually merges with
            the view below — Chrome-like, no hard edges. The human client
            thread and the AI chat are separate, clearly-labeled views. */}
        <div
          role="tablist"
          aria-label={t("switch_view")}
          className="flex items-end gap-1 bg-[#11110f] px-2.5 pt-1"
        >
          <PanelTab
            active={tab === "messages" && !infoOpen}
            onClick={() => {
              setAssistantTab("messages");
              setInfoOpen(false);
            }}
            icon={MessageSquare}
            label={t("tab_client_messages")}
            badge={
              selected && pageEngagement?.id === selected.id
                ? (pageEngagement?.messagesUnread ?? 0)
                : 0
            }
          />
          <PanelTab
            active={tab === "chat" && !infoOpen}
            onClick={() => {
              setAssistantTab("chat");
              setInfoOpen(false);
            }}
            icon={Sparkles}
            label={t("tab_ai_chat")}
          />
          <PanelTab
            active={tab === "activity" && !infoOpen}
            onClick={() => {
              setAssistantTab("activity");
              setInfoOpen(false);
            }}
            icon={History}
            label={t("tab_activity")}
          />
        </div>

        {/* Content region. Chat + Activity both stay mounted (visibility
            toggled, not unmounted) so chat history and the activity feed
            survive a view switch — same guarantee the old forceMount tabs
            gave. The Info overlay, when open, expands over this whole region
            (the header stays visible above it). */}
        <div className="relative flex-1 min-h-0">
          <div className="absolute inset-0 flex flex-col">
            <div
              className={cn(
                "flex min-h-0 flex-1 flex-col",
                tab !== "messages" && "hidden",
              )}
            >
              <ClientMessagesTab engagement={selected} locale={locale} />
            </div>
            <div
              className={cn(
                "flex-1 min-h-0 flex flex-col",
                tab !== "chat" && "hidden",
              )}
            >
              <ChatTab locale={locale} />
            </div>
            <div
              className={cn(
                "flex-1 min-h-0 overflow-y-auto overscroll-contain",
                tab !== "activity" && "hidden",
              )}
            >
              <ActivityTab
                engagementId={selected?.id ?? null}
                locale={locale}
                active={open && tab === "activity"}
              />
            </div>
          </div>
          {open && infoOpen && (
            <AssistantInfo onClose={() => setInfoOpen(false)} />
          )}
        </div>
      </aside>
    </>
  );
}

// One rounded browser-style tab. The active tab's background matches the
// content region (bg-black) so tab and view read as one connected surface.
function PanelTab({
  active,
  onClick,
  icon: Icon,
  label,
  badge = 0,
}: {
  active: boolean;
  onClick: () => void;
  icon: LucideIcon;
  label: string;
  // Unread count pill (client messages only).
  badge?: number;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex cursor-pointer items-center gap-1.5 rounded-t-xl px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-black text-foreground"
          : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {label}
      {badge > 0 && (
        <span className="inline-flex min-w-[1.125rem] items-center justify-center rounded-full bg-accent px-1 py-0.5 text-[10px] font-semibold leading-none text-accent-foreground">
          {badge}
        </span>
      )}
    </button>
  );
}
