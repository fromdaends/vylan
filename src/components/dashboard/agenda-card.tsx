"use client";

// Today / agenda card (design 2a) — the day, at a glance, in the left column.
//
// The DATE lives here, not in the greeting: the header greets, this card
// answers "what is my day".
//
// ── FOUR STATES, AND THEY SAY DIFFERENT THINGS ─────────────────────────────
//
//   not configured  — this deployment has no Google credentials. Says so; no
//                     button, because a button that cannot work is a lie.
//   not connected   — a real Connect button. YOUR calendar, your click: no
//                     owner permission involved (see the connect route).
//   needs reconnect — Google revoked the grant (or a Testing-mode consent
//                     screen aged out at 7 days). "Reconnect", not "connect".
//   connected       — the day's events, the account, when it last synced.
//
// The chevrons genuinely page: today is server-rendered with the page, and
// every other day is fetched from the events route. An unconnected card still
// pages the DATE — reading "what day is Thursday" is useful on its own.

import { useCallback, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { CalendarDays, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import type { CalendarConnection, CalendarEvent } from "@/lib/calendar/provider";
import { addDays } from "@/lib/tasks/dates";
import { formatRelative, type AppLocale } from "@/lib/format";

// The four token hues the mock rotates through for event dots.
const DOT_CLASSES = [
  "bg-accent",
  "bg-warning",
  "bg-success",
  "bg-icon-purple",
] as const;

export function AgendaCard({
  initialDay,
  connection,
  events,
  isConfigured,
}: {
  /** Today, YYYY-MM-DD, in the FIRM's timezone — computed on the server. */
  initialDay: string;
  connection: CalendarConnection | null;
  /** Events for initialDay, server-rendered so the common case needs no fetch. */
  events: CalendarEvent[];
  /** False when the deployment has no Google client id/secret. */
  isConfigured: boolean;
}) {
  const t = useTranslations("Dashboard");
  const locale = useLocale();
  const [offset, setOffset] = useState(0);
  const day = addDays(initialDay, offset);

  // Day -> events. Seeded with the server's day so going back to today is
  // instant and costs nothing.
  const [byDay, setByDay] = useState<Record<string, CalendarEvent[]>>({
    [initialDay]: events,
  });
  const [loading, setLoading] = useState(false);
  // Guards against a slow response for a day the user has already paged past.
  const wantedDay = useRef(initialDay);

  const connected = Boolean(connection && !connection.needsReconnect);

  const loadDay = useCallback(
    async (target: string) => {
      wantedDay.current = target;
      setLoading(true);
      try {
        const res = await fetch(
          `/api/integrations/calendar/google/events?day=${target}`,
        );
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as { events?: CalendarEvent[] };
        // Ignore a late answer for a day we have navigated away from.
        if (wantedDay.current !== target) return;
        setByDay((m) => ({ ...m, [target]: json.events ?? [] }));
      } catch {
        if (wantedDay.current !== target) return;
        // An empty day is the honest fallback; the footer still says when the
        // last real sync happened, so nothing here claims to be fresh.
        setByDay((m) => ({ ...m, [target]: [] }));
      } finally {
        if (wantedDay.current === target) setLoading(false);
      }
    },
    [],
  );

  // Paging fetches from the CLICK, not from an effect watching `day`. Both
  // would work; this one is honest about cause and effect (the user asked for
  // another day, so we go and get it) and it keeps setState out of an effect,
  // which the React Compiler rejects outright.
  const goToOffset = useCallback(
    (next: number) => {
      setOffset(next);
      const target = addDays(initialDay, next);
      if (!connected || byDay[target] !== undefined) return;
      void loadDay(target);
    },
    [connected, byDay, loadDay, initialDay],
  );

  const shown = byDay[day] ?? [];

  // "MONDAY, AUGUST" over a large "3" — weekday + month up top, day below.
  // Assembled by hand: asking Intl for weekday+month together lets the locale
  // pick the order, and English chose "August Monday" on the real page.
  const d = new Date(`${day}T12:00:00Z`);
  const part = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { ...opts, timeZone: "UTC" }).format(d);
  const eyebrow = `${part({ weekday: "long" })}, ${part({ month: "long" })}`;
  const dayNumber = part({ day: "numeric" });

  const timeRange = (ev: CalendarEvent) => {
    if (ev.allDay) return t("agenda_all_day");
    const fmt = new Intl.DateTimeFormat(locale, {
      hour: "numeric",
      minute: "2-digit",
    });
    const a = new Date(ev.startsAt);
    const b = new Date(ev.endsAt);
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return "";
    return `${fmt.format(a)} – ${fmt.format(b)}`;
  };

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-card">
      <div className="flex items-start justify-between gap-2.5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {eyebrow}
          </p>
          <p className="text-[32px] font-semibold leading-[1.15] tracking-[-0.02em] tabular-nums">
            {dayNumber}
          </p>
        </div>
        <div className="mt-0.5 flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => goToOffset(offset - 1)}
            aria-label={t("agenda_prev_day")}
            className="flex size-[26px] items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronLeft className="size-[15px]" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => goToOffset(offset + 1)}
            aria-label={t("agenda_next_day")}
            className="flex size-[26px] items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronRight className="size-[15px]" aria-hidden />
          </button>
        </div>
      </div>

      <div className="mb-1 mt-4 h-px bg-border/70" />

      {connected ? (
        loading && shown.length === 0 ? (
          <div className="flex items-center gap-2 px-1 py-5 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {t("agenda_loading")}
          </div>
        ) : shown.length > 0 ? (
          <div className="flex flex-col">
            {shown.map((ev, i) => {
              const row = (
                <>
                  <span
                    aria-hidden
                    className={`mt-1 size-2 flex-none rounded-full ${DOT_CLASSES[i % DOT_CLASSES.length]}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs tabular-nums text-muted-foreground">
                      {timeRange(ev)}
                    </p>
                    <p className="mt-0.5 truncate text-sm font-medium">
                      {ev.title}
                    </p>
                  </div>
                </>
              );
              return ev.href ? (
                <a
                  key={ev.id}
                  href={ev.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex gap-3 rounded-md px-1 py-3 transition-colors hover:bg-secondary/60"
                >
                  {row}
                </a>
              ) : (
                <div key={ev.id} className="flex gap-3 rounded-md px-1 py-3">
                  {row}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="px-1 py-5 text-sm text-muted-foreground">
            {t("agenda_empty_day")}
          </p>
        )
      ) : (
        <ConnectBlock
          isConfigured={isConfigured}
          needsReconnect={Boolean(connection?.needsReconnect)}
        />
      )}

      {connected && connection && (
        <div className="mt-2 flex items-center justify-between gap-2 border-t border-border/60 pt-3 text-xs text-muted-foreground">
          <span className="min-w-0 truncate">
            {connection.email ?? "Google Calendar"}
            {connection.lastSyncedAt && (
              <>
                {" · "}
                {formatRelative(connection.lastSyncedAt, locale as AppLocale)}
              </>
            )}
          </span>
          <a
            href="https://calendar.google.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex-none font-medium text-accent transition-colors hover:text-accent-hover"
          >
            {t("agenda_open_calendar")}
          </a>
        </div>
      )}
    </div>
  );
}

/**
 * The unconnected half. Split out so the connected card above stays readable —
 * and because "not configured", "connect" and "reconnect" are three different
 * messages that share one layout.
 */
function ConnectBlock({
  isConfigured,
  needsReconnect,
}: {
  isConfigured: boolean;
  needsReconnect: boolean;
}) {
  const t = useTranslations("Dashboard");
  const [busy, setBusy] = useState(false);

  async function connect() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/integrations/calendar/google/connect", {
        method: "POST",
      });
      const json = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (res.ok && json.url) {
        // Full navigation, not a popup: Google's consent screen refuses to be
        // framed, and a popup is one blocker away from looking broken.
        window.location.href = json.url;
        return;
      }
      toast.error(
        json.error === "not_configured" || json.error === "encryption_required"
          ? t("agenda_connect_unavailable")
          : t("agenda_connect_failed"),
      );
    } catch {
      toast.error(t("agenda_connect_failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex gap-3 px-1 py-5">
      <CalendarDays
        className="mt-0.5 size-4 flex-none text-muted-foreground"
        aria-hidden
      />
      <div className="min-w-0">
        <p className="text-sm font-medium">
          {needsReconnect
            ? t("agenda_reconnect_title")
            : t("agenda_connect_title")}
        </p>
        <p className="mt-1 text-xs leading-snug text-muted-foreground">
          {!isConfigured
            ? t("agenda_connect_unavailable")
            : needsReconnect
              ? t("agenda_reconnect_hint")
              : t("agenda_connect_hint")}
        </p>
        {isConfigured && (
          <button
            type="button"
            onClick={connect}
            disabled={busy}
            className="mt-2.5 inline-flex h-8 items-center gap-1.5 rounded-md bg-secondary px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-secondary/80 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            {needsReconnect
              ? t("agenda_reconnect_button")
              : t("agenda_connect_button")}
          </button>
        )}
      </div>
    </div>
  );
}
