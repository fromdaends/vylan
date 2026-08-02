"use client";

// One client's bank reconciliation, on the close board.
//
// Collapsed it is a single verdict — "Reconciled", "Off by $240.15", "2 of 3"
// — and it starts blank with a "Check" next to it for the same reason the rest
// of this board does: reading the books is a live call, and a number nobody
// asked for is a number nobody can trust.
//
// Expanded it lists each bank and credit-card account with what the LEDGER
// says and a box for what the STATEMENT says. Typing the statement figure is
// the only manual step; the comparison is the software's job.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { formatCurrency, type AppLocale } from "@/lib/format";
import {
  reconcileAccount,
  type ReconAccount,
  type ReconSummary,
} from "@/lib/close/reconciliation";
import { setStatementBalanceAction } from "@/app/actions/statement-balance";

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | {
      kind: "loaded";
      accounts: ReconAccount[];
      summary: ReconSummary;
      problem: "none" | "reconnect_required" | "unavailable";
    }
  | { kind: "error"; message: string };

// "1234.56" / "-89" / "1 234,56" → cents. Returns null for anything that is
// not a number, so an empty or half-typed box never saves a 0.
export function parseAmountToCents(raw: string): number | null {
  const cleaned = raw.trim().replace(/[\s,$]/g, "").replace(",", ".");
  if (cleaned === "" || !/^-?\d*\.?\d+$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

export function BankRecCell({
  clientId,
  period,
  locale,
}: {
  clientId: string;
  period: string;
  locale: AppLocale;
}) {
  const t = useTranslations("Quickbooks");
  const [state, setState] = useState<State>({ kind: "idle" });
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  async function load() {
    setState({ kind: "loading" });
    try {
      const res = await fetch("/api/quickbooks/close/reconciliation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, period }),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        accounts?: ReconAccount[];
        summary?: ReconSummary;
        problem?: "none" | "reconnect_required" | "unavailable";
        error?: string;
      };
      if (!res.ok || !body.ok || !body.summary) {
        setState({
          kind: "error",
          message:
            body.error === "not_connected"
              ? t("close_not_connected_row")
              : t("close_check_failed"),
        });
        return;
      }
      setState({
        kind: "loaded",
        accounts: body.accounts ?? [],
        summary: body.summary,
        problem: body.problem ?? "none",
      });
      setOpen(true);
    } catch {
      setState({ kind: "error", message: t("close_check_failed") });
    }
  }

  async function save(account: ReconAccount) {
    const cents = parseAmountToCents(drafts[account.accountId] ?? "");
    if (cents == null) return;
    setSaving(account.accountId);
    const res = await setStatementBalanceAction({
      clientId,
      accountId: account.accountId,
      period,
      balanceCents: cents,
    });
    setSaving(null);
    if (!res.ok) {
      setState({ kind: "error", message: res.error ?? t("close_check_failed") });
      return;
    }
    // Re-read rather than patching locally: the difference must always come
    // from the live book balance, never from what the browser assumed.
    await load();
    setDrafts((d) => ({ ...d, [account.accountId]: "" }));
  }

  if (state.kind === "idle") {
    return (
      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={load}>
        {t("rec_check")}
      </Button>
    );
  }
  if (state.kind === "loading") {
    return (
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        {t("close_checking")}
      </span>
    );
  }
  if (state.kind === "error") {
    return (
      <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-500">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {state.message}
      </span>
    );
  }

  const { summary, accounts, problem } = state;
  const money = (cents: number) => formatCurrency(cents / 100, locale);

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex cursor-pointer items-center gap-1.5 text-left underline-offset-4 hover:underline"
      >
        {problem !== "none" ? (
          <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-500">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {problem === "reconnect_required"
              ? t("rec_reconnect")
              : t("rec_unreadable")}
          </span>
        ) : summary.total === 0 ? (
          <span className="text-muted-foreground">{t("rec_no_accounts")}</span>
        ) : summary.reconciled === summary.total ? (
          <span className="flex items-center gap-1.5 text-icon-emerald">
            <Check className="h-4 w-4 shrink-0" aria-hidden />
            {t("rec_reconciled")}
          </span>
        ) : summary.off > 0 ? (
          <span className="text-amber-600 dark:text-amber-500">
            {t("rec_off_by", {
              amount: money(Math.abs(summary.largestDifferenceCents ?? 0)),
            })}
          </span>
        ) : (
          <span className="text-muted-foreground">
            {t("rec_awaiting", { count: summary.unknown })}
          </span>
        )}
      </button>

      {open && accounts.length > 0 && (
        <ul className="flex flex-col gap-1.5 border-l border-border/60 pl-3">
          {accounts.map((account) => {
            const status = reconcileAccount(account);
            return (
              <li key={account.accountId} className="flex flex-wrap items-center gap-2 text-xs">
                <span className="min-w-[8rem] truncate font-medium">
                  {account.name}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {account.bookBalanceCents == null
                    ? t("rec_books_unreadable")
                    : t("rec_books_say", {
                        amount: money(account.bookBalanceCents),
                      })}
                </span>
                {status.kind === "reconciled" ? (
                  <span className="flex items-center gap-1 text-icon-emerald">
                    <Check className="h-3.5 w-3.5" aria-hidden />
                    {t("rec_matches")}
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <Input
                      value={drafts[account.accountId] ?? ""}
                      onChange={(e) =>
                        setDrafts((d) => ({
                          ...d,
                          [account.accountId]: e.target.value,
                        }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void save(account);
                      }}
                      inputMode="decimal"
                      placeholder={t("rec_statement_placeholder")}
                      aria-label={t("rec_statement_label", {
                        account: account.name,
                      })}
                      className="h-7 w-28 text-xs tabular-nums"
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-7 px-2"
                      disabled={
                        saving === account.accountId ||
                        parseAmountToCents(drafts[account.accountId] ?? "") == null
                      }
                      onClick={() => void save(account)}
                    >
                      {saving === account.accountId ? (
                        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                      ) : (
                        t("rec_save")
                      )}
                    </Button>
                    {status.kind === "off" && (
                      <span
                        className={cn("tabular-nums text-amber-600 dark:text-amber-500")}
                      >
                        {t("rec_off_by", {
                          amount: money(Math.abs(status.differenceCents)),
                        })}
                      </span>
                    )}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
