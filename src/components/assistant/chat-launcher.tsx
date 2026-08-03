"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { usePathname } from "@/i18n/navigation";
import { ChevronDown, MessagesSquare } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  closeChat,
  collapseMessages,
  getChatLauncherServerSnapshot,
  getChatLauncherState,
  openAi,
  openChat,
  openMessages,
  subscribeChatLauncher,
} from "@/components/assistant/chat-launcher-store";

// The heavy half — the framer-motion popup, both chat tabs and the docked
// sidebar — loads on the FIRST open and then stays mounted (history + polls
// survive close/reopen exactly as before the split). ssr:false: it is pure
// browser UI behind a click.
const ChatLauncherPanel = dynamic(
  () =>
    import("@/components/assistant/chat-launcher-panel").then(
      (m) => m.ChatLauncherPanel,
    ),
  { ssr: false },
);

// Routes that own the bottom-right corner themselves. The launcher is fixed
// there, so on the engagement builder it sat right on top of "Create and send"
// — a primary action you do NOT want anyone fat-fingering. On these pages the
// launcher is removed outright rather than nudged, since moving it would just
// shift the collision onto something else. Locale-stripped paths (next-intl's
// usePathname), so /en/... and /fr/... both match.
const LAUNCHER_HIDDEN_ON: readonly RegExp[] = [/^\/engagements\/new(\/|$)/];

// The global chat launcher, built on the SignWell pattern (founder spec): a
// bottom-right button that pops a compact panel ABOVE itself. The button stays
// put and becomes a round collapse arrow while the panel is open — so there is
// no X in the panel; that arrow is how you close it. Mounted once in the app
// layout.
//
// THIS file is only the LIGHT half: the button, the unread-dot seed, and the
// app-wide open channels. Everything behind the click lives in
// chat-launcher-panel.tsx and enters the page as its own chunk on first open —
// before the split, the panel (framer-motion + the whole messaging stack) rode
// in every authenticated page's first-load bundle and its inbox tab seeded
// itself with a fetch per navigation.
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
  const { open, expanded } = useSyncExternalStore(
    subscribeChatLauncher,
    getChatLauncherState,
    getChatLauncherServerSnapshot,
  );
  const pathname = usePathname();
  const hidden = LAUNCHER_HIDDEN_ON.some((re) => re.test(pathname));

  const fabRef = useRef<HTMLButtonElement | null>(null);

  // Mount the heavy panel on first open and never unmount it after — the
  // original single-component version kept everything mounted for state
  // continuity, and this preserves that from the first open onward.
  const [panelRequested, setPanelRequested] = useState(false);

  // Firm-wide unread total. Seeded here with ONE fetch (the same request the
  // inbox tab makes), so the dot is right before the panel has ever loaded;
  // once the panel mounts, its inbox owns this number.
  const [messagesUnread, setMessagesUnread] = useState(0);
  useEffect(() => {
    if (panelRequested) return;
    const ctl = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/client-messages/conversations", {
          signal: ctl.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          conversations?: { unreadCount: number }[];
          team?: { unreadCount: number } | null;
        };
        const total =
          (data.conversations ?? []).reduce((n, c) => n + c.unreadCount, 0) +
          (data.team?.unreadCount ?? 0);
        setMessagesUnread(total);
      } catch {
        // Seed is best-effort; the dot simply stays off.
      }
    })();
    return () => ctl.abort();
    // Once per mount — the panel takes over live updates after first open.
  }, [panelRequested]);

  // App-wide open channels: the profile "Help" menu fires vylan:open-help
  // (→ Vylan AI), and notification "reply" rows fire vylan:assistant:open with
  // tab "messages" (→ the inbox). Same window-event channel the old panel used,
  // so those callers didn't have to change. Both also pull the panel chunk in.
  useEffect(() => {
    function onOpenHelp() {
      setPanelRequested(true);
      openAi();
    }
    function onOpenAssistant(e: Event) {
      const detail = (e as CustomEvent).detail as { tab?: string } | undefined;
      setPanelRequested(true);
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

  // Navigating INTO a hidden route while the popup is open would otherwise
  // leave it "open" in the store and pop it back up on the next page.
  useEffect(() => {
    if (!hidden) return;
    if (open) closeChat();
    // The docked sidebar is a separate surface with its own flag, so closing
    // the popup alone would leave it pinned to the page.
    if (expanded) collapseMessages();
  }, [hidden, open, expanded]);

  const badge = messagesUnread > 0;

  // After every hook, so the rules of hooks hold on the routes that hide it.
  if (hidden) return null;

  return (
    <>
      {/* The launcher button (SignWell): it does NOT disappear when the panel
          opens — it stays anchored and becomes a round collapse arrow, which is
          the panel's only close control. Hidden only while the docked sidebar
          is open, since that surface has its own collapse control. Plain CSS
          transforms here — the button must not be the reason framer-motion
          ships on every page. */}
      {!expanded && (
        <button
          ref={fabRef}
          type="button"
          onClick={() => {
            if (open) {
              closeChat();
            } else {
              setPanelRequested(true);
              openChat();
            }
          }}
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
            "transition-[transform,box-shadow] duration-150 ease-out hover:scale-[1.04] active:scale-95",
            !open && "hover:-translate-y-px",
            "hover:shadow-[0_16px_40px_-12px_rgba(0,0,0,0.5)]",
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
        </button>
      )}

      {panelRequested && (
        <ChatLauncherPanel
          locale={locale}
          userId={userId}
          firstName={firstName}
          fabRef={fabRef}
          messagesUnread={messagesUnread}
          onUnreadTotal={setMessagesUnread}
        />
      )}
    </>
  );
}
