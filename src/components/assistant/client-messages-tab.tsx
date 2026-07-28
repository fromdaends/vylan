"use client";

// The panel's "Client messages" tab (founder redesign): a social-style,
// cross-client INBOX — every client conversation in one list with unread
// dots, no engagement picker to fumble with. Tap a row to open that thread.
//
// Conversations are per-engagement (the thread model) but shown client-first:
// the client's name leads, the engagement is the subtitle. Opening a row hosts
// the existing EngagementMessages thread (which fetches + stamps the firm read
// pointer on visibility), so this component only owns the list ⇆ thread nav.
//
// When the firm has a team, the firm's internal team chat is PINNED at the top
// of the inbox as its own conversation — the firm's name + logo lead the row
// like a client would, and opening it hosts the shared TeamChat thread.

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, Loader2, MessagesSquare, Pin } from "lucide-react";
import { cn } from "@/lib/cn";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { Button } from "@/components/ui/button";
import { EngagementMessages } from "@/components/engagements/engagement-messages";
import { TeamThread } from "@/components/assistant/team-thread";
import type { FirmConversation } from "@/lib/db/client-messages";
import type { TeamConversation } from "@/lib/db/team-messages";

// Inbox refresh while the panel is open. A touch slower than an open thread —
// this is a heavier list query and runs on every panel-open, whereas the open
// conversation (EngagementMessages) polls every few seconds for the live feel.
const POLL_MS = 10_000;

// The pinned team conversation's slot in `openId`. Engagement ids are UUIDs,
// so this sentinel can never collide with a real conversation.
export const TEAM_CONVERSATION_ID = "__team__";

// Deterministic avatar tints so the list reads like a real inbox (different
// people, different colors) without storing anything. All chosen to sit well
// on the panel's dark navy surface.
const AVATAR_COLORS = [
  "#0f766e",
  "#4f46e5",
  "#be123c",
  "#b45309",
  "#0e7490",
  "#7c3aed",
  "#047857",
  "#c026d3",
];

function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]!;
}

// Compact, locale-correct relative time ("3 min ago" / "il y a 3 min").
function formatRelative(iso: string, locale: "en" | "fr"): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diffSec = Math.round((then - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat(locale === "fr" ? "fr-CA" : "en-CA", {
    numeric: "auto",
    style: "narrow",
  });
  if (abs < 60) return rtf.format(Math.round(diffSec), "second");
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(diffSec / 3600), "hour");
  if (abs < 604_800) return rtf.format(Math.round(diffSec / 86_400), "day");
  if (abs < 2_629_800) return rtf.format(Math.round(diffSec / 604_800), "week");
  return rtf.format(Math.round(diffSec / 2_629_800), "month");
}

export function ClientMessagesTab({
  locale,
  active,
  onUnreadTotal,
}: {
  locale: "fr" | "en";
  // The panel is open — fetch + poll the inbox (independent of which tab shows,
  // so the tab's unread badge stays live).
  active: boolean;
  // Report the firm's total unread across all conversations (drives the tab +
  // FAB badge). Pass a stable setter.
  onUnreadTotal?: (total: number) => void;
}) {
  const t = useTranslations("Assistant");
  const tTeam = useTranslations("TeamChat");
  const [conversations, setConversations] = useState<FirmConversation[] | null>(
    null,
  );
  const [team, setTeam] = useState<TeamConversation | null>(null);
  const [failed, setFailed] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/client-messages/conversations");
      if (!res.ok) {
        setFailed(true);
        return;
      }
      const data = (await res.json()) as {
        conversations?: FirmConversation[];
        team?: TeamConversation | null;
      };
      if (Array.isArray(data.conversations)) {
        setConversations(data.conversations);
        setTeam(data.team ?? null);
        setFailed(false);
      }
    } catch {
      setFailed(true);
    }
  }, []);

  // Seed once on mount (the panel mounts on every app page) so the FAB's unread
  // dot is right before the panel is ever opened. Deferred to a frame callback
  // so the fetch's state writes never land synchronously in the effect body.
  useEffect(() => {
    const frame = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(frame);
  }, [load]);

  // Then poll while the panel stays open — only while the document is visible,
  // so a backgrounded tab stays quiet.
  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => void load());
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(timer);
    };
  }, [active, load]);

  // Keep the parent's badge in step with the loaded inbox (team included).
  useEffect(() => {
    if (!conversations && !team) return;
    const total =
      (conversations ?? []).reduce((n, c) => n + c.unreadCount, 0) +
      (team?.unreadCount ?? 0);
    onUnreadTotal?.(total);
  }, [conversations, team, onUnreadTotal]);

  const openConversation = useCallback((id: string) => {
    setOpenId(id);
    // Opening a thread marks it read — clear its unread optimistically so the
    // badge drops immediately (the next inbox load confirms it).
    if (id === TEAM_CONVERSATION_ID) {
      setTeam((prev) => (prev ? { ...prev, unreadCount: 0 } : prev));
      return;
    }
    setConversations((prev) =>
      prev
        ? prev.map((c) =>
            c.engagementId === id ? { ...c, unreadCount: 0 } : c,
          )
        : prev,
    );
  }, []);

  const backToInbox = useCallback(() => {
    setOpenId(null);
    void load();
  }, [load]);

  // --- Team thread view ---------------------------------------------------
  if (openId === TEAM_CONVERSATION_ID) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {/* Same slim back row as a client thread, but carrying the firm's
            identity + the team-only reassurance (TeamChat's own header is
            hidden — this row replaces it). */}
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1.5">
          <button
            type="button"
            onClick={backToInbox}
            aria-label={t("messages_back_to_inbox")}
            title={t("messages_back_to_inbox")}
            className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronLeft className="size-4" aria-hidden />
          </button>
          <AvatarInitials
            src={team?.logoUrl}
            name={team?.firmName ?? tTeam("thread_title")}
            size={26}
            color="#4f46e5"
          />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium leading-tight text-foreground">
              {team?.firmName ?? tTeam("thread_title")}
            </p>
            <p className="truncate text-[10px] leading-tight text-muted-foreground">
              {tTeam("team_only")}
            </p>
          </div>
        </div>
        <div className="min-h-0 flex-1">
          <TeamThread locale={locale} active={active} hideHeader />
        </div>
      </div>
    );
  }

  // --- Thread view --------------------------------------------------------
  if (openId) {
    const conv = conversations?.find((c) => c.engagementId === openId) ?? null;
    const status = conv?.status ?? "in_progress";
    const isLive = status === "sent" || status === "in_progress";
    return (
      <div className="flex h-full min-h-0 flex-col">
        {/* One slim row IS the thread header: a bare back arrow plus the
            client's name. Replaces the old "All conversations" link stacked
            above a second, larger "Messages with X" banner. */}
        <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-2 py-1.5">
          <button
            type="button"
            onClick={backToInbox}
            aria-label={t("messages_back_to_inbox")}
            title={t("messages_back_to_inbox")}
            className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronLeft className="size-4" aria-hidden />
          </button>
          <p className="min-w-0 truncate text-[13px] font-medium text-foreground">
            {conv?.clientName ?? conv?.engagementTitle ?? ""}
          </p>
        </div>
        <div className="min-h-0 flex-1">
          <EngagementMessages
            key={openId}
            engagementId={openId}
            clientName={conv?.clientName ?? null}
            initialMessages={[]}
            deferInitialLoad
            hideHeader
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
        </div>
      </div>
    );
  }

  // --- Inbox list ---------------------------------------------------------
  return (
    <div className="flex h-full min-h-0 flex-col">
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
        ) : (
          <>
            {team && (
              <div className="border-b border-border/60">
                <TeamConversationRow
                  team={team}
                  locale={locale}
                  onOpen={() => openConversation(TEAM_CONVERSATION_ID)}
                  subtitle={tTeam("thread_title")}
                  youPrefix={t("messages_preview_you")}
                  noMessages={t("messages_no_messages_yet")}
                  unreadLabel={(n) => t("messages_unread_count", { count: n })}
                />
              </div>
            )}
            {conversations && conversations.length === 0 ? (
              <div
                className={cn(
                  "flex flex-col items-center justify-center gap-2 px-6 text-center",
                  team ? "py-16" : "h-full",
                )}
              >
                <MessagesSquare
                  className="size-6 text-muted-foreground/60"
                  aria-hidden
                />
                <p className="text-sm font-medium text-foreground">
                  {t("messages_inbox_empty")}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t("messages_inbox_empty_hint")}
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border/60">
                {(conversations ?? []).map((c) => (
                  <li key={c.engagementId}>
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
          </>
        )}
      </div>
    </div>
  );
}

export function ConversationRow({
  conversation: c,
  locale,
  onOpen,
  youPrefix,
  noMessages,
  unreadLabel,
}: {
  conversation: FirmConversation;
  locale: "fr" | "en";
  onOpen: () => void;
  youPrefix: string;
  noMessages: string;
  unreadLabel: (n: number) => string;
}) {
  const unread = c.unreadCount > 0;
  const title = c.clientName ?? c.engagementTitle;
  const preview = c.lastMessage
    ? (c.lastMessage.sender === "firm" ? youPrefix : "") +
      c.lastMessage.body.replace(/\s+/g, " ").trim()
    : noMessages;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      <AvatarInitials
        name={title}
        size={46}
        color={avatarColor(c.clientName ?? c.engagementId)}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span
            className={cn(
              "truncate text-sm",
              unread
                ? "font-semibold text-foreground"
                : "font-medium text-foreground/90",
            )}
          >
            {title}
          </span>
          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
            {formatRelative(c.lastActivityAt, locale)}
          </span>
        </span>
        <span
          className={cn(
            "mt-0.5 block truncate text-xs",
            unread ? "text-foreground/80" : "text-muted-foreground",
          )}
        >
          {preview}
        </span>
        {c.clientName && (
          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground/70">
            {c.engagementTitle}
          </span>
        )}
      </span>
      {unread && (
        <span
          className="size-2.5 shrink-0 rounded-full bg-accent"
          role="img"
          aria-label={unreadLabel(c.unreadCount)}
        />
      )}
    </button>
  );
}

// The pinned team-chat row: same anatomy as a client conversation (avatar,
// name, preview, time, unread dot), but the firm's own identity leads and a
// small pin marks it as the fixture it is. Shared by the popup inbox and the
// expanded sidebar's list.
export function TeamConversationRow({
  team,
  locale,
  onOpen,
  subtitle,
  youPrefix,
  noMessages,
  unreadLabel,
}: {
  team: TeamConversation;
  locale: "fr" | "en";
  onOpen: () => void;
  // The "Team chat" line under the firm name (mirrors the engagement subtitle
  // on client rows).
  subtitle: string;
  youPrefix: string;
  noMessages: string;
  unreadLabel: (n: number) => string;
}) {
  const unread = team.unreadCount > 0;
  const preview = team.lastMessage
    ? (team.lastMessage.mine
        ? youPrefix
        : `${team.lastMessage.senderName}: `) +
      team.lastMessage.body.replace(/\s+/g, " ").trim()
    : noMessages;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      <AvatarInitials
        src={team.logoUrl}
        name={team.firmName}
        size={46}
        color="#4f46e5"
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span
            className={cn(
              "truncate text-sm",
              unread
                ? "font-semibold text-foreground"
                : "font-medium text-foreground/90",
            )}
          >
            {team.firmName}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
            <Pin className="size-3 rotate-45" aria-hidden />
            {team.lastMessage
              ? formatRelative(team.lastMessage.createdAt, locale)
              : null}
          </span>
        </span>
        <span
          className={cn(
            "mt-0.5 block truncate text-xs",
            unread ? "text-foreground/80" : "text-muted-foreground",
          )}
        >
          {preview}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground/70">
          {subtitle}
        </span>
      </span>
      {unread && (
        <span
          className="size-2.5 shrink-0 rounded-full bg-accent"
          role="img"
          aria-label={unreadLabel(team.unreadCount)}
        />
      )}
    </button>
  );
}
