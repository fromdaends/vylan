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
  ChevronDown,
  Maximize2,
  MessagesSquare,
  Sparkles,
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

// The global chat launcher, built on the SignWell pattern (founder spec): a
// bottom-right button that pops a compact panel ABOVE itself. The button stays
// put and becomes a round collapse arrow while the panel is open — so there is
// no X in the panel; that arrow is how you close it.
//
// The panel is two colour zones: a generous navy band carrying the centred
// Messages/Vylan toggle + a greeting, and the content below it, pulled up over
// the band's edge so the surfaces read as stacked layers. Toggles between the
// Client-messages inbox and the read-only Vylan AI chat; "Expand" swaps it for
// the docked resizable sidebar. Mounted once in the app layout.
//
// z-index: 50 — the same layer the old FAB used, above the app chrome. Radix
// popovers/dropdowns still stack above (their own portals at higher z).
export function ChatLauncher({
  locale,
  userId,
  firstName,
}: {
  locale: "en" | "fr";
  userId: string;
  // Just the given name, for the greeting ("Hi Zach 👋"). Empty when unknown —
  // the greeting falls back to a name-less "Hi 👋".
  firstName?: string;
}) {
  const t = useTranslations("Assistant");
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
      {/* The launcher button (SignWell): it does NOT disappear when the panel
          opens — it stays anchored and becomes a round collapse arrow, which is
          the panel's only close control. Hidden only while the docked sidebar
          is open, since that surface has its own collapse control. */}
      {!expanded && (
        <motion.button
          ref={fabRef}
          type="button"
          whileHover={{ scale: 1.04, y: open ? 0 : -1 }}
          whileTap={{ scale: 0.95 }}
          transition={{ type: "spring", stiffness: 400, damping: 28 }}
          onClick={() => (open ? closeChat() : openChat())}
          aria-expanded={open}
          aria-label={
            open
              ? t("launcher_collapse")
              : badge
                ? `${t("launcher_button")} (${t("launcher_unread")})`
                : t("launcher_button")
          }
          className={cn(
            "fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] sm:bottom-6 right-4 sm:right-6 z-50",
            "inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground",
            "shadow-[0_10px_30px_-10px_rgba(0,0,0,0.45)] ring-1 ring-black/5 dark:ring-white/5",
            "transition-shadow hover:shadow-[0_16px_40px_-12px_rgba(0,0,0,0.5)]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            open ? "size-12" : "gap-2 px-4 py-2.5 text-sm font-medium",
          )}
        >
          {open ? (
            <ChevronDown className="size-5" aria-hidden />
          ) : (
            <>
              <MessagesSquare className="size-4" aria-hidden />
              <span>{t("launcher_button")}</span>
              {badge && (
                <span
                  className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-accent ring-2 ring-background"
                  aria-hidden
                />
              )}
            </>
          )}
        </motion.button>
      )}

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
            : { opacity: 0, scale: 0.85, y: 14 }
        }
        transition={
          open
            ? {
                // Quick pop from the button corner with a light overshoot
                // (`visualDuration` = perceived settle time, `bounce` = how far
                // it overshoots — framer-motion v12 spring API). Deliberately
                // brisk: the panel should feel instant, not animated at.
                type: "spring",
                visualDuration: 0.2,
                bounce: 0.28,
                opacity: { duration: 0.1, ease: "easeOut" },
              }
            : // Close is quick and calm — no bounce on the way out.
              { duration: 0.12, ease: "easeIn" }
        }
        style={{ transformOrigin: "bottom right" }}
        className={cn(
          // Sits ABOVE the launcher button (which stays visible as the collapse
          // arrow), so the offsets clear the button + a gap.
          "fixed z-50 right-4 sm:right-6 bottom-[calc(8.75rem+env(safe-area-inset-bottom))] sm:bottom-[5.25rem]",
          "flex w-[calc(100vw-2rem)] sm:w-[420px] h-[70vh] sm:h-[640px] max-h-[calc(100vh-11rem)] flex-col overflow-hidden",
          "rounded-2xl border border-border bg-card text-foreground shadow-[0_24px_60px_-24px_rgba(0,0,0,0.7)] dark:bg-black",
          !open && "pointer-events-none",
        )}
      >
        {/* The navy zone: a generous colour band (not a thin bar) carrying the
            centred toggle and the greeting — the SignWell proportion. No close
            button lives here; the launcher arrow below the panel does that. */}
        <div className="relative shrink-0 bg-chat-header px-4 pt-3.5 pb-9 text-chat-header-foreground">
          <div className="relative flex items-center justify-center">
            {/* No enclosing track: the two modes are separate items, and only
                the active one carries a soft pill that blends into the navy
                (SignWell) — not a connected segmented control. */}
            <div
              role="tablist"
              aria-label={t("switch_view")}
              className="inline-flex items-center gap-1"
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
            {/* Expand lives quietly in the corner so the toggle stays centred. */}
            {mode === "messages" && (
              <button
                type="button"
                onClick={expandMessages}
                aria-label={t("launcher_expand")}
                title={t("launcher_expand")}
                className="absolute right-0 inline-flex size-8 items-center justify-center rounded-full text-chat-header-foreground/70 transition-colors hover:bg-white/10 hover:text-chat-header-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              >
                <Maximize2 className="size-4" aria-hidden />
              </button>
            )}
          </div>
          {/* The greeting belongs to the AI ("ask me anything"), not to the
              message list — so it collapses away when you switch to Messages,
              leaving a slimmer band and more room for conversations. */}
          <AnimatePresence initial={false}>
            {mode === "ai" && (
              <motion.div
                key="greeting"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="overflow-hidden"
              >
                <p className="pt-5 text-center text-xl font-semibold tracking-tight">
                  {firstName
                    ? t("launcher_greeting_name", { name: firstName })
                    : t("launcher_greeting")}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Body: both views mounted, visibility toggled, so switching modes (or
            closing) never drops the inbox's unread polling or the AI history.
            Deliberately NOT separately animated — it rides the frame's pop, so
            the content (client names, etc.) never appears to settle on its own
            timing while the frame is still springing.

            Pulled up over the navy band's edge (-mt-5 + rounded top) so the two
            surfaces read as stacked layers rather than stapled together. */}
        <div className="relative -mt-5 min-h-0 flex-1 overflow-hidden rounded-t-2xl bg-card dark:bg-black">
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
        "inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70",
        // Both sides keep white text; the active one just gains a translucent
        // pill a shade lighter than the band, so it reads as part of the
        // colour rather than a control sitting on top of it.
        active
          ? "bg-white/20 text-chat-header-foreground"
          : "text-chat-header-foreground/70 hover:bg-white/10 hover:text-chat-header-foreground",
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {label}
      {badge > 0 && (
        <span
          className={cn(
            "inline-flex min-w-[1.125rem] items-center justify-center rounded-full px-1 py-0.5 text-[10px] font-semibold leading-none",
            "bg-white text-chat-header",
          )}
        >
          {badge}
        </span>
      )}
    </button>
  );
}
