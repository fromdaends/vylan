"use client";

// The Team-chat view inside the bottom-right chat launcher. Only mounted while
// the Team page is open (the launcher gates it on teamChatAvailable), so it
// loads the firm's thread on demand and tears down when you leave the page.
//
// Thin wrapper: fetches the thread + who "me" is once, then hands off to the
// shared <TeamChat> thread component (bubbles, composer, poll).

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { TeamChat } from "@/components/team/team-chat";
import type { TeamMessageRow } from "@/lib/db/team-messages";

type LoadState =
  | { status: "loading" }
  | { status: "not_ready" }
  | { status: "error" }
  | { status: "ready"; messages: TeamMessageRow[]; currentUserId: string };

export function TeamChatTab({
  locale,
  active,
}: {
  locale: "fr" | "en";
  active: boolean;
}) {
  const t = useTranslations("TeamChat");
  const [state, setState] = useState<LoadState>({ status: "loading" });

  // Load once, the first time the view is actually shown.
  useEffect(() => {
    if (!active || state.status !== "loading") return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/team/messages");
        if (res.status === 503) {
          if (!cancelled) setState({ status: "not_ready" });
          return;
        }
        if (!res.ok) {
          if (!cancelled) setState({ status: "error" });
          return;
        }
        const data = (await res.json()) as {
          messages?: TeamMessageRow[];
          currentUserId?: string;
        };
        if (cancelled) return;
        setState({
          status: "ready",
          messages: Array.isArray(data.messages) ? data.messages : [],
          currentUserId: data.currentUserId ?? "",
        });
      } catch {
        if (!cancelled) setState({ status: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, state.status]);

  if (state.status !== "ready") {
    const msg =
      state.status === "loading"
        ? t("loading")
        : state.status === "not_ready"
          ? t("not_activated")
          : t("send_failed");
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
        {msg}
      </div>
    );
  }

  return (
    <TeamChat
      currentUserId={state.currentUserId}
      initialMessages={state.messages}
      notActivated={false}
      locale={locale}
    />
  );
}
