"use client";

// The missing-receipt list, and the one action on it: ask the client.
//
// Deliberately a plain table with hairlines rather than cards — this is a
// working list an accountant scans top-down for the amounts that matter, and
// boxing each row would make forty of them unreadable. Biggest amount first
// (the server sorts), because that is the order anyone actually chases in.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { ReceiptIcon } from "@/components/quickbooks/receipt-icon";
import { SelectionBar } from "@/components/quickbooks/selection-bar";

type Gap = {
  qboId: string;
  entity: "bill" | "purchase";
  txnDate: string | null;
  totalAmt: number;
  currency: string | null;
  docNumber: string | null;
  vendorId: string | null;
  vendorName: string | null;
  accountName: string | null;
};

const keyOf = (g: Gap) => `${g.entity}:${g.qboId}`;

export function ReceiptGaps(props: {
  clients: { id: string; name: string }[];
  // Rendered on ONE client's page: the whole screen is already about them, so
  // the picker would be a way to walk to a different client from inside a page
  // whose header names this one. The date range stays — that is a question
  // about this client's books, not about which client you are reading.
  lockedClient?: boolean;
  selectedClientId: string;
  from: string;
  to: string;
  gaps: Gap[];
  considered: number;
  truncated: boolean;
  scanFailed: boolean;
  alreadyChased: string[];
  engagements: { id: string; title: string }[];
  locale: string;
}) {
  const t = useTranslations("Quickbooks");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const chased = useMemo(
    () => new Set(props.alreadyChased),
    [props.alreadyChased],
  );
  // Only offer what has not been asked about — asking twice is the fastest way
  // to make a client stop reading their portal.
  const askable = useMemo(
    () => props.gaps.filter((g) => !chased.has(keyOf(g))),
    [props.gaps, chased],
  );

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [engagementId, setEngagementId] = useState(
    props.engagements[0]?.id ?? "",
  );
  const [sending, setSending] = useState(false);

  const setParam = (key: string, value: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set(key, value);
    startTransition(() => router.replace(url.pathname + url.search));
  };

  const toggle = (k: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const allSelected = askable.length > 0 && selected.size === askable.length;

  async function send() {
    if (selected.size === 0 || !engagementId) return;
    setSending(true);
    try {
      const res = await fetch("/api/quickbooks/receipts/chase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: props.selectedClientId,
          engagementId,
          from: props.from,
          to: props.to,
          keys: [...selected],
        }),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        created?: number;
        skippedDuplicate?: number;
        stale?: number;
        detail?: string;
        error?: string;
      };
      if (!res.ok || !body.ok) {
        toast.error(body.detail ?? t("gaps_send_failed"));
        return;
      }
      toast.success(t("gaps_sent", { count: body.created ?? 0 }));
      setSelected(new Set());
      startTransition(() => router.refresh());
    } catch {
      toast.error(t("gaps_send_failed"));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Controls: which client, what period. Kept as quiet inline selects
          rather than a filter bar — one row of chrome above a working list. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {!props.lockedClient && (
          <Select
            value={props.selectedClientId}
            onValueChange={(v) => setParam("client", v)}
          >
            <SelectTrigger className="h-8 w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {props.clients.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <label className="flex items-center gap-2 text-muted-foreground">
          {t("gaps_from")}
          <input
            type="date"
            defaultValue={props.from}
            onChange={(e) => e.target.value && setParam("from", e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-foreground"
          />
        </label>
        <label className="flex items-center gap-2 text-muted-foreground">
          {t("gaps_to")}
          <input
            type="date"
            defaultValue={props.to}
            onChange={(e) => e.target.value && setParam("to", e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-foreground"
          />
        </label>
        {pending && (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
        )}
      </div>

      {props.scanFailed ? (
        <Note tone="warn">{t("gaps_scan_failed")}</Note>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {t("gaps_count", {
              gaps: props.gaps.length,
              considered: props.considered,
            })}
          </p>
          {props.truncated && <Note tone="warn">{t("gaps_truncated")}</Note>}
        </>
      )}

      {!props.scanFailed && props.gaps.length === 0 && (
        <div className="py-14 text-center">
          <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary/60 ring-1 ring-inset ring-border/50">
            <ReceiptIcon className="h-7 w-7 text-muted-foreground" />
          </div>
          <p className="mt-4 text-sm font-medium">{t("gaps_none_title")}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("gaps_none_body")}
          </p>
        </div>
      )}

      {props.gaps.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="w-9 py-2">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    aria-label={t("gaps_select_all")}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? new Set(askable.map(keyOf))
                          : new Set<string>(),
                      )
                    }
                  />
                </th>
                <th className="w-12 py-2 font-medium">{t("gaps_col_date")}</th>
                <th className="py-2 font-medium">{t("gaps_col_supplier")}</th>
                <th className="py-2 font-medium">{t("gaps_col_account")}</th>
                <th className="w-[88px] py-2 text-right font-medium">
                  {t("gaps_col_amount")}
                </th>
              </tr>
            </thead>
            <tbody>
              {props.gaps.map((g) => {
                const k = keyOf(g);
                const asked = chased.has(k);
                return (
                  <tr
                    key={k}
                    className="border-b border-border/50 last:border-0"
                  >
                    <td className="py-2.5">
                      {asked ? (
                        <Check
                          className="h-4 w-4 text-icon-emerald"
                          aria-label={t("gaps_already_asked")}
                        />
                      ) : (
                        <input
                          type="checkbox"
                          checked={selected.has(k)}
                          onChange={() => toggle(k)}
                          aria-label={g.vendorName ?? g.qboId}
                        />
                      )}
                    </td>
                    <td className="py-2.5 tabular-nums text-muted-foreground">
                      {g.txnDate ?? "—"}
                    </td>
                    <td className="py-2.5">
                      {g.vendorName ?? (
                        <span className="text-muted-foreground">
                          {t("gaps_no_supplier")}
                        </span>
                      )}
                      {asked && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {t("gaps_already_asked")}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 text-muted-foreground">
                      {g.accountName ?? "—"}
                    </td>
                    <td className="py-2.5 text-right font-medium tabular-nums">
                      {g.totalAmt.toFixed(2)}
                      {g.currency ? (
                        <span className="ml-1 text-xs text-muted-foreground">
                          {g.currency}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* The action FLOATS once something is ticked. It used to sit under the
          table, which put it a thousand pixels below the fold on a real list —
          so ticking a row answered the click with nothing visible at all. */}
      <SelectionBar
        count={selected.size}
        onClear={() => setSelected(new Set())}
      >
        {props.engagements.length === 0 ? (
          <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-500">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
            {t("gaps_no_open_engagement")}
          </span>
        ) : (
          <>
            <span className="text-muted-foreground">{t("gaps_ask_on")}</span>
            <Select value={engagementId} onValueChange={setEngagementId}>
              <SelectTrigger className="h-8 w-[200px] rounded-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {props.engagements.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              className="rounded-full"
              onClick={send}
              disabled={sending}
            >
              {sending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              )}
              {t("gaps_ask_button", { count: selected.size })}
            </Button>
          </>
        )}
      </SelectionBar>

    </div>
  );
}

function Note({
  tone,
  children,
}: {
  tone: "ok" | "warn";
  children: React.ReactNode;
}) {
  return (
    <p
      className={
        tone === "ok"
          ? "flex items-center gap-2 text-sm text-icon-emerald"
          : "flex items-center gap-2 text-sm text-amber-600 dark:text-amber-500"
      }
    >
      {tone === "ok" ? (
        <Check className="h-4 w-4 shrink-0" aria-hidden />
      ) : (
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
      )}
      {children}
    </p>
  );
}
