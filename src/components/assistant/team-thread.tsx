"use client";

// The team-chat thread as hosted by the Messages inbox — behind the pinned
// team conversation row in the compact popup and the expanded sidebar.
//
// Thin wrapper: fetches the thread + who "me" is once (the first time it's
// actually shown), then hands off to the shared <TeamChat> thread component
// (bubbles, composer, poll, read-stamping).

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { TeamChat } from "@/components/team/team-chat";
import type { TeamMessageRow } from "@/lib/db/team-messages";

type LoadState =
  | { status: "loading" }
  | { status: "not_ready" }
  | { status: "error" }
  | { status: "ready"; messages: TeamMessageRow[]; currentUserId: string };

export function TeamThread({
  locale,
  active,
  hideHeader = false,
}: {
  locale: "fr" | "en";
  active: boolean;
  // Forwarded to TeamChat — the popup's back row already carries the firm
  // identity + team-only hint, so the built-in header would double up there.
  hideHeader?: boolean;
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
        // 503 = migration 0870 not applied yet; 403 = the firm isn't a team
        // (shouldn't be reachable — the pinned row is gated the same way).
        if (res.status === 503 || res.status === 403) {
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
      hideHeader={hideHeader}
      locale={locale}
    />
  );
}
