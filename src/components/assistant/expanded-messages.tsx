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
import { ChevronsRight, Loader2, MessagesSquare } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { EngagementMessages } from "@/components/engagements/engagement-messages";
import { ConversationRow } from "@/components/assistant/client-messages-tab";
import {
  clampPanelWidth,
  clearStoredPanelWidth,
  defaultPanelWidth,
  PANEL_MAX_FRACTION,
  PANEL_MIN_WIDTH_PX,
  readStoredPanelWidth,
  storePanelWidth,
} from "@/components/assistant/assistant-prefs";
import {
  collapseMessages,
  getChatLauncherServerSnapshot,
  getChatLauncherState,
  subscribeChatLauncher,
} from "@/components/assistant/chat-launcher-store";
import type { FirmConversation } from "@/lib/db/client-messages";

// The "Expand" surface: messaging as a docked, drag-to-resize sidebar with the
// Instagram-DM two-pane layout (thread list left, active conversation right).
// Opt-in (opened from the popup's Expand control), NOT the old default panel.
// Desktop only — on mobile the compact popup already fills the screen, so an
// accidental expand there just collapses back. Reuses the conversation list
// row, the EngagementMessages thread, and the panel's width prefs verbatim.
const POLL_MS = 10_000;

export function ExpandedMessages({
  locale,
  userId,
  onUnreadTotal,
}: {
  locale: "en" | "fr";
  userId: string;
  onUnreadTotal?: (total: number) => void;
}) {
  const t = useTranslations("Assistant");
  const { expanded } = useSyncExternalStore(
    subscribeChatLauncher,
    getChatLauncherState,
    getChatLauncherServerSnapshot,
  );

  const [conversations, setConversations] = useState<FirmConversation[] | null>(
    null,
  );
  const [failed, setFailed] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/client-messages/conversations");
      if (!res.ok) {
        setFailed(true);
        return;
      }
      const data = (await res.json()) as { conversations?: FirmConversation[] };
      if (Array.isArray(data.conversations)) {
        setConversations(data.conversations);
        setFailed(false);
      }
    } catch {
      setFailed(true);
    }
  }, []);

  // Seed + poll only while the sidebar is open (visible-tab only).
  useEffect(() => {
    if (!expanded) return;
    const frame = requestAnimationFrame(() => void load());
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(timer);
    };
  }, [expanded, load]);

  // Keep the shared FAB / popup badge in step with what we loaded.
  useEffect(() => {
    if (!conversations) return;
    onUnreadTotal?.(conversations.reduce((n, c) => n + c.unreadCount, 0));
  }, [conversations, onUnreadTotal]);

  // On a viewport that's too narrow for a docked sidebar, collapse back to the
  // popup (the Expand control is desktop-only, so this only fires on resize).
  useEffect(() => {
    if (!expanded) return;
    function onResize() {
      if (window.innerWidth < 640) collapseMessages();
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [expanded]);

  // -------------------------------------------------------------------------
  // Width + drag-to-resize (left edge). Same contract as the old assistant
  // panel: default 35% of the viewport, clamped [400px, 60vw], persisted per
  // user, double-click resets.
  // -------------------------------------------------------------------------
  const [width, setWidth] = useState<number | null>(null);
  const [viewportW, setViewportW] = useState<number | null>(null);
  const widthRef = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);

  const applyWidth = useCallback((px: number) => {
    widthRef.current = px;
    setWidth(px);
  }, []);

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

  const onHandleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const STEP = 24;
      const current = widthRef.current ?? 0;
      let next: number | null = null;
      if (e.key === "ArrowLeft") next = current + STEP;
      else if (e.key === "ArrowRight") next = current - STEP;
      else if (e.key === "Home") next = Number.POSITIVE_INFINITY;
      else if (e.key === "End") next = 0;
      else return;
      e.preventDefault();
      const clamped = clampPanelWidth(next, window.innerWidth);
      applyWidth(clamped);
      storePanelWidth(userId, clamped);
    },
    [userId, applyWidth],
  );

  // Kill text selection + show the resize cursor page-wide while dragging.
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

  // Shrink the app's main column while the sidebar is docked (the same
  // split-workspace contract the old panel used; AppShell reads this var).
  useEffect(() => {
    const w = width ?? defaultPanelWidth(window.innerWidth);
    document.documentElement.style.setProperty(
      "--assistant-shell-offset",
      expanded ? `${w + 16}px` : "0px",
    );
  }, [expanded, width]);

  useEffect(() => {
    return () => {
      document.documentElement.style.removeProperty("--assistant-shell-offset");
    };
  }, []);

  const openConversation = useCallback((id: string) => {
    setOpenId(id);
    setConversations((prev) =>
      prev
        ? prev.map((c) => (c.engagementId === id ? { ...c, unreadCount: 0 } : c))
        : prev,
    );
  }, []);

  const conv = conversations?.find((c) => c.engagementId === openId) ?? null;
  const status = conv?.status ?? "in_progress";
  const isLive = status === "sent" || status === "in_progress";

  return (
    <aside
      inert={!expanded}
      aria-hidden={!expanded}
      aria-label={t("launcher_messages")}
      style={
        { "--exp-w": width != null ? `${width}px` : "35vw" } as CSSProperties
      }
      className={cn(
        "fixed inset-y-2 right-2 z-[45] w-[var(--exp-w)] flex-col overflow-hidden rounded-2xl border border-border bg-card text-foreground",
        "shadow-[-18px_0_48px_-28px_rgba(0,0,0,0.75),0_18px_50px_-30px_rgba(0,0,0,0.8)]",
        dragging ? "transition-none" : "transition-transform duration-300 ease-out",
        expanded ? "hidden sm:flex" : "hidden",
      )}
    >
      {/* Drag handle — left edge. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t("resize_handle")}
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
        className="group absolute inset-y-0 left-0 z-10 flex w-2 -ml-1 cursor-col-resize touch-none items-center justify-center focus-visible:outline-none"
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

      {/* Header: title + collapse back to the popup. */}
      <header className="flex shrink-0 items-center gap-2 border-b border-border bg-secondary px-4 py-2.5">
        <MessagesSquare className="size-4 text-muted-foreground" aria-hidden />
        <h2 className="text-sm font-semibold tracking-tight">
          {t("launcher_messages")}
        </h2>
        <button
          type="button"
          onClick={collapseMessages}
          aria-label={t("launcher_collapse")}
          title={t("launcher_collapse")}
          className="ml-auto inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronsRight className="size-4" aria-hidden />
        </button>
      </header>

      {/* Two-pane body: conversation list (left) + active thread (right). */}
      <div className="flex min-h-0 flex-1">
        <div className="flex w-[40%] min-w-[220px] max-w-[340px] flex-col border-r border-border">
          <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
            {conversations === null && !failed ? (
              <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                {t("loading")}
              </div>
            ) : failed && conversations === null ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                <span>{t("activity_error")}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => void load()}
                >
                  {t("retry")}
                </Button>
              </div>
            ) : conversations && conversations.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                <MessagesSquare
                  className="size-6 text-muted-foreground/60"
                  aria-hidden
                />
                <p className="text-sm font-medium text-foreground">
                  {t("messages_inbox_empty")}
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border/60">
                {(conversations ?? []).map((c) => (
                  <li
                    key={c.engagementId}
                    className={cn(
                      c.engagementId === openId && "bg-muted/60",
                    )}
                  >
                    <ConversationRow
                      conversation={c}
                      locale={locale}
                      onOpen={() => openConversation(c.engagementId)}
                      youPrefix={t("messages_preview_you")}
                      noMessages={t("messages_no_messages_yet")}
                      unreadLabel={(n) =>
                        t("messages_unread_count", { count: n })
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          {openId ? (
            <EngagementMessages
              key={openId}
              engagementId={openId}
              clientName={conv?.clientName ?? null}
              initialMessages={[]}
              deferInitialLoad
              notActivated={false}
              readOnly={!isLive}
              readOnlyReason={
                status === "cancelled"
                  ? "cancelled"
                  : status === "complete"
                    ? "complete"
                    : status === "draft"
                      ? "draft"
                      : null
              }
              locale={locale}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <MessagesSquare
                className="size-7 text-muted-foreground/50"
                aria-hidden
              />
              <p className="max-w-xs text-sm text-muted-foreground">
                {t("expanded_select_hint")}
              </p>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
