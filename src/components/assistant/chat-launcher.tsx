"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
} from "react";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion } from "framer-motion";
import {
  Maximize2,
  MessagesSquare,
  Sparkles,
  X,
  type LucideProps,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { ClientMessagesTab } from "@/components/assistant/client-messages-tab";
import { LauncherAiChat } from "@/components/assistant/launcher-ai-chat";
import { ExpandedMessages } from "@/components/assistant/expanded-messages";
import {
  closeChat,
  expandMessages,
  getChatLauncherServerSnapshot,
  getChatLauncherState,
  openAi,
  openChat,
  openMessages,
  setChatMode,
  subscribeChatLauncher,
} from "@/components/assistant/chat-launcher-store";

// The global chat launcher: a bottom-right button that opens a compact,
// animated popup (scale + fade from the button corner, Instagram / Intercom
// style). The popup toggles between the Client-messages inbox and the read-only
// Vylan AI chat. From the messages view, "Expand" swaps the popup for a docked,
// resizable messaging sidebar. Mounted once in the app layout, so it rides
// along on every screen — this is what replaced the always-docked panel.
//
// z-index: 50 — the same layer the old FAB used, above the app chrome. Radix
// popovers/dropdowns still stack above (their own portals at higher z).
export function ChatLauncher({
  locale,
  userId,
}: {
  locale: "en" | "fr";
  userId: string;
}) {
  const t = useTranslations("Assistant");
  const tc = useTranslations("Common");
  const { open, mode, expanded } = useSyncExternalStore(
    subscribeChatLauncher,
    getChatLauncherState,
    getChatLauncherServerSnapshot,
  );

  const popupRef = useRef<HTMLDivElement | null>(null);
  const fabRef = useRef<HTMLButtonElement | null>(null);

  // Firm-wide unread total, reported up by the inbox. Kept in launcher state so
  // the FAB dot is right even while the popup is closed (the inbox stays
  // mounted below and seeds it on load).
  const [messagesUnread, setMessagesUnread] = useState(0);

  // Escape closes the popup. Restore focus to the FAB, matching the old panel.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeChat();
        fabRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Click outside the popup (and not on the FAB) closes it — the expected
  // dismiss for this popover pattern. Radix popovers inside portal elsewhere,
  // so a click on one of those won't be "inside" popupRef; guard against that
  // by ignoring clicks that land on a [data-radix-popper-content-wrapper].
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Element | null;
      if (!target) return;
      if (popupRef.current?.contains(target)) return;
      if (fabRef.current?.contains(target)) return;
      if (target.closest("[data-radix-popper-content-wrapper]")) return;
      closeChat();
    }
    // Defer binding a tick so the opening click doesn't immediately close it.
    const id = window.setTimeout(
      () => window.addEventListener("pointerdown", onPointerDown),
      0,
    );
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  // App-wide open channels: the profile "Help" menu fires vylan:open-help
  // (→ Vylan AI), and notification "reply" rows fire vylan:assistant:open with
  // tab "messages" (→ the inbox). Same window-event channel the old panel used,
  // so those callers didn't have to change.
  useEffect(() => {
    function onOpenHelp() {
      openAi();
    }
    function onOpenAssistant(e: Event) {
      const detail = (e as CustomEvent).detail as { tab?: string } | undefined;
      if (detail?.tab === "messages") openMessages();
      else openAi();
    }
    window.addEventListener("vylan:open-help", onOpenHelp);
    window.addEventListener("vylan:assistant:open", onOpenAssistant);
    return () => {
      window.removeEventListener("vylan:open-help", onOpenHelp);
      window.removeEventListener("vylan:assistant:open", onOpenAssistant);
    };
  }, []);

  const badge = messagesUnread > 0;

  return (
    <>
      {/* FAB — the "Chats" button. Hidden while the popup or the expanded
          sidebar is open (each has its own close control). */}
      <AnimatePresence>
        {!open && !expanded && (
          <motion.button
            ref={fabRef}
            type="button"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            whileHover={{ scale: 1.04, y: -1 }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: "spring", stiffness: 400, damping: 28 }}
            onClick={() => openChat()}
            className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] sm:bottom-6 right-4 sm:right-6 z-50 group inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-[0_10px_30px_-10px_rgba(0,0,0,0.45)] ring-1 ring-black/5 dark:ring-white/5 hover:shadow-[0_16px_40px_-12px_rgba(0,0,0,0.5)] transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-label={
              badge
                ? `${t("launcher_button")} (${t("launcher_unread")})`
                : t("launcher_button")
            }
          >
            <span className="relative inline-flex items-center justify-center">
              <MessagesSquare className="relative size-4" aria-hidden />
            </span>
            <span>{t("launcher_button")}</span>
            {badge && (
              <span
                className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-accent ring-2 ring-background"
                aria-hidden
              />
            )}
          </motion.button>
        )}
      </AnimatePresence>

      {/* The compact popup. Kept mounted so the inbox keeps seeding the unread
          dot and the AI chat keeps its history across close/reopen; visibility
          + interactivity are toggled by `open` (and animated from the button
          corner). */}
      <motion.div
        ref={popupRef}
        role="dialog"
        aria-label={t("launcher_button")}
        aria-hidden={!open}
        inert={!open}
        initial={false}
        animate={
          open
            ? { opacity: 1, scale: 1, y: 0 }
            : { opacity: 0, scale: 0.96, y: 8 }
        }
        transition={{ type: "spring", stiffness: 460, damping: 34, mass: 0.7 }}
        style={{ transformOrigin: "bottom right" }}
        className={cn(
          "fixed z-50 right-4 sm:right-6 bottom-[calc(5rem+env(safe-area-inset-bottom))] sm:bottom-6",
          "flex w-[calc(100vw-2rem)] sm:w-[400px] h-[70vh] sm:h-[600px] max-h-[calc(100vh-6rem)] flex-col overflow-hidden",
          "rounded-2xl border border-border bg-card text-foreground shadow-[0_24px_60px_-24px_rgba(0,0,0,0.7)]",
          !open && "pointer-events-none",
        )}
      >
        {/* Header: mode toggle + expand (messages only) + close. */}
        <header className="flex shrink-0 items-center gap-2 border-b border-border bg-secondary px-2.5 py-2">
          <div
            role="tablist"
            aria-label={t("switch_view")}
            className="inline-flex rounded-full bg-background/70 p-0.5"
          >
            <ModeTab
              active={mode === "messages"}
              onClick={() => setChatMode("messages")}
              icon={MessagesSquare}
              label={t("launcher_messages")}
              badge={messagesUnread}
            />
            <ModeTab
              active={mode === "ai"}
              onClick={() => setChatMode("ai")}
              icon={Sparkles}
              label={t("tab_ai_chat")}
            />
          </div>
          <div className="ml-auto flex items-center gap-0.5">
            {mode === "messages" && (
              <button
                type="button"
                onClick={expandMessages}
                aria-label={t("launcher_expand")}
                title={t("launcher_expand")}
                className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Maximize2 className="size-4" aria-hidden />
              </button>
            )}
            <button
              type="button"
              onClick={closeChat}
              aria-label={tc("close")}
              className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        </header>

        {/* Body: both views mounted, visibility toggled, so switching modes (or
            closing) never drops the inbox's unread polling or the AI history. */}
        <div className="relative min-h-0 flex-1">
          <div
            className={cn(
              "absolute inset-0 flex min-h-0 flex-col",
              mode !== "messages" && "hidden",
            )}
          >
            <ClientMessagesTab
              locale={locale}
              active={open && mode === "messages"}
              onUnreadTotal={setMessagesUnread}
            />
          </div>
          <div
            className={cn(
              "absolute inset-0 flex min-h-0 flex-col",
              mode !== "ai" && "hidden",
            )}
          >
            <LauncherAiChat locale={locale} />
          </div>
        </div>
      </motion.div>

      {/* The opt-in docked, resizable messaging sidebar (Expand). Its own
          surface; shares the launcher store. */}
      <ExpandedMessages
        locale={locale}
        userId={userId}
        onUnreadTotal={setMessagesUnread}
      />
    </>
  );
}

// One rounded segmented-control tab in the popup header.
function ModeTab({
  active,
  onClick,
  icon: Icon,
  label,
  badge = 0,
}: {
  active: boolean;
  onClick: () => void;
  icon: ComponentType<LucideProps>;
  label: string;
  badge?: number;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {label}
      {badge > 0 && (
        <span
          className={cn(
            "inline-flex min-w-[1.125rem] items-center justify-center rounded-full px-1 py-0.5 text-[10px] font-semibold leading-none",
            active
              ? "bg-primary-foreground/20 text-primary-foreground"
              : "bg-accent text-accent-foreground",
          )}
        >
          {badge}
        </span>
      )}
    </button>
  );
}
