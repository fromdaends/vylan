"use client";

// The close board: every connected client, one month, down a single screen.
//
// TWO KINDS OF NUMBER, AND THE SCREEN NEVER CONFUSES THEM. What the client owes
// comes from Vylan's own database and is on screen the moment the page loads.
// What their books look like comes from reading QuickBooks live, so it starts
// blank with a "Check" next to it — because the honest thing to show before
// anyone has looked is nothing at all, not a zero.
//
// That distinction is the whole reason this board is trustworthy. A zero that
// means "clean" and a zero that means "we have not looked" are the same pixel,
// and a firm that closes a month on the second one has signed off on books
// nobody read.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from "lucide-react";
import {
  periodLabel,
  periodStart,
  periodEnd,
  shiftPeriod,
} from "@/lib/close/period";
import {
  closeMonthAction,
  reopenMonthAction,
} from "@/app/actions/month-close";

type Row = {
  clientId: string;
  name: string;
  openRequests: number;
  closedAt: string | null;
  closedBy: string | null;
};

type Books =
  | { kind: "unchecked" }
  | { kind: "checking" }
  | {
      kind: "checked";
      uncategorized: number;
      missingReceipts: number;
      truncated: boolean;
    }
  | { kind: "error"; message: string };

export function CloseBoard(props: {
  period: string;
  locale: string;
  rows: Row[];
}) {
  const t = useTranslations("Quickbooks");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [books, setBooks] = useState<Record<string, Books>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [migrationNote, setMigrationNote] = useState<string | null>(null);
  const [checkingAll, setCheckingAll] = useState(false);

  const loc = props.locale === "fr" ? "fr" : "en";
  const from = useMemo(() => periodStart(props.period), [props.period]);
  const to = useMemo(() => periodEnd(props.period), [props.period]);

  const goToPeriod = (period: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("period", period);
    startTransition(() => router.replace(url.pathname + url.search));
  };

  async function check(clientId: string) {
    setBooks((b) => ({ ...b, [clientId]: { kind: "checking" } }));
    try {
      const res = await fetch("/api/quickbooks/close/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, period: props.period }),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        uncategorized?: number;
        missingReceipts?: number;
        truncated?: boolean;
        detail?: string;
        error?: string;
      };
      if (!res.ok || !body.ok) {
        setBooks((b) => ({
          ...b,
          [clientId]: {
            kind: "error",
            message:
              body.error === "not_connected"
                ? t("close_not_connected_row")
                : (body.detail ?? t("close_check_failed")),
          },
        }));
        return;
      }
      setBooks((b) => ({
        ...b,
        [clientId]: {
          kind: "checked",
          uncategorized: body.uncategorized ?? 0,
          missingReceipts: body.missingReceipts ?? 0,
          truncated: Boolean(body.truncated),
        },
      }));
    } catch {
      setBooks((b) => ({
        ...b,
        [clientId]: { kind: "error", message: t("close_check_failed") },
      }));
    }
  }

  // One client at a time. Intuit rate limits per company, and a firm with
  // twenty clients firing twenty concurrent scans gets 429s that look exactly
  // like the feature being broken.
  async function checkAll() {
    setCheckingAll(true);
    for (const row of props.rows) {
      await check(row.clientId);
    }
    setCheckingAll(false);
  }

  async function setClosed(clientId: string, closed: boolean) {
    setBusy((b) => ({ ...b, [clientId]: true }));
    setMigrationNote(null);
    try {
      const result = closed
        ? await closeMonthAction({ clientId, period: props.period })
        : await reopenMonthAction({ clientId, period: props.period });
      if (!result.ok) {
        if (result.needsMigration) setMigrationNote(result.error ?? null);
        return;
      }
      startTransition(() => router.refresh());
    } finally {
      setBusy((b) => ({ ...b, [clientId]: false }));
    }
  }

  const closedCount = props.rows.filter((r) => r.closedAt).length;

  return (
    <div className="flex flex-col gap-5">
      {/* Which month. Arrows rather than a date picker: a close board is walked
          month by month, and the next thing anyone wants is almost always the
          one before or the one after. */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            aria-label={t("close_previous_month")}
            onClick={() => goToPeriod(shiftPeriod(props.period, -1))}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Button>
          <span className="min-w-[9rem] text-center text-sm font-medium">
            {periodLabel(props.period, loc)}
          </span>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            aria-label={t("close_next_month")}
            onClick={() => goToPeriod(shiftPeriod(props.period, 1))}
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
        </div>
        <span className="text-sm text-muted-foreground">
          {t("close_progress", {
            closed: closedCount,
            total: props.rows.length,
          })}
        </span>
        <Button
          size="sm"
          variant="secondary"
          onClick={checkAll}
          disabled={checkingAll}
        >
          {checkingAll && (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
          )}
          {t("close_check_all")}
        </Button>
        {pending && (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
        )}
      </div>

      {migrationNote && (
        <p className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-500">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          {migrationNote}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="py-2 font-medium">{t("close_col_client")}</th>
              <th className="py-2 font-medium">{t("close_col_owed")}</th>
              <th className="py-2 font-medium">{t("close_col_books")}</th>
              <th className="py-2 font-medium">{t("close_col_month")}</th>
            </tr>
          </thead>
          <tbody>
            {props.rows.map((row) => {
              const state = books[row.clientId] ?? { kind: "unchecked" };
              const isClosed = Boolean(row.closedAt);
              return (
                <tr
                  key={row.clientId}
                  className="border-b border-border/50 last:border-0"
                >
                  <td className="py-2.5 align-top font-medium">{row.name}</td>

                  <td className="py-2.5 align-top">
                    {row.openRequests === 0 ? (
                      <span className="text-muted-foreground">
                        {t("close_nothing_owed")}
                      </span>
                    ) : (
                      <span>
                        {t("close_owed", { count: row.openRequests })}
                      </span>
                    )}
                  </td>

                  <td className="py-2.5 align-top">
                    {state.kind === "unchecked" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2"
                        onClick={() => check(row.clientId)}
                      >
                        {t("close_check")}
                      </Button>
                    )}
                    {state.kind === "checking" && (
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                        {t("close_checking")}
                      </span>
                    )}
                    {state.kind === "error" && (
                      <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-500">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        {state.message}
                      </span>
                    )}
                    {state.kind === "checked" &&
                      (state.uncategorized === 0 &&
                      state.missingReceipts === 0 ? (
                        <span className="flex items-center gap-1.5 text-icon-emerald">
                          <Check className="h-4 w-4 shrink-0" aria-hidden />
                          {t("close_books_clean")}
                        </span>
                      ) : (
                        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          {state.uncategorized > 0 && (
                            <Link
                              href={`/quickbooks/drafts?tab=uncategorized&client=${row.clientId}&from=${from}&to=${to}`}
                              className="underline-offset-4 hover:underline"
                            >
                              {t("close_uncategorized", {
                                count: state.uncategorized,
                              })}
                            </Link>
                          )}
                          {state.missingReceipts > 0 && (
                            <Link
                              href={`/quickbooks/drafts?tab=receipts&client=${row.clientId}&from=${from}&to=${to}`}
                              className="underline-offset-4 hover:underline"
                            >
                              {t("close_missing_receipts", {
                                count: state.missingReceipts,
                              })}
                            </Link>
                          )}
                          {state.truncated && (
                            <span className="text-xs text-amber-600 dark:text-amber-500">
                              {t("close_truncated")}
                            </span>
                          )}
                        </span>
                      ))}
                  </td>

                  <td className="py-2.5 align-top">
                    <div className="flex flex-wrap items-center gap-2">
                      {isClosed ? (
                        <>
                          <span className="flex items-center gap-1.5 text-icon-emerald">
                            <Check className="h-4 w-4 shrink-0" aria-hidden />
                            {row.closedBy
                              ? t("close_closed_by", { who: row.closedBy })
                              : t("close_closed")}
                          </span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2"
                            disabled={busy[row.clientId]}
                            onClick={() => setClosed(row.clientId, false)}
                          >
                            {t("close_reopen")}
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy[row.clientId]}
                          onClick={() => setClosed(row.clientId, true)}
                        >
                          {busy[row.clientId] && (
                            <Loader2
                              className="mr-1.5 h-3.5 w-3.5 animate-spin"
                              aria-hidden
                            />
                          )}
                          {t("close_mark_closed")}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Said once, at the bottom, rather than as a warning on every unchecked
          row — the point is to be understood, not to nag. */}
      <p className="text-xs text-muted-foreground">{t("close_footnote")}</p>
    </div>
  );
}
