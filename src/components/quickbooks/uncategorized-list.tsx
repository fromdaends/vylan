"use client";

// The list of things nobody has coded, and the one action on each: code it.
//
// A plain table with hairlines, like its sibling the missing-receipt list — this
// is a working list an accountant reads top-down, and boxing forty rows would
// make it unreadable. Biggest uncoded amount first (the server sorts).
//
// THE PICKER IS A NATIVE <select>, ON PURPOSE. A chart of accounts runs to
// hundreds of entries; a native select gives typeahead, keyboard scrolling and
// a mobile wheel for free, and matches the native date inputs already on this
// screen. A styled listbox would be prettier and slower to use, and this is a
// screen someone works through fifty rows of.
//
// NOTHING WRITES UNTIL "APPLY". Choosing an account only arms the row — the
// button then appears. A select that wrote on change would send an accidental
// scroll straight into the client's books.

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

type Txn = {
  qboId: string;
  entity: "purchase" | "bill" | "deposit";
  txnDate: string | null;
  totalAmt: number;
  uncatAmt: number;
  currency: string | null;
  docNumber: string | null;
  partyName: string | null;
  accountName: string | null;
  memo: string | null;
  lineIds: string[];
};

type Account = { id: string; name: string; type: string | null };

const keyOf = (t: Txn) => `${t.entity}:${t.qboId}`;

// The account types that are plausibly right for each kind of entry, floated to
// the top of the picker. Everything else stays available underneath — this is a
// hint about what is usually correct, never a rule about what is allowed. If
// QuickBooks refuses an account, its own message is what the firm sees.
const LIKELY_TYPES: Record<Txn["entity"], readonly string[]> = {
  purchase: ["Expense", "Other Expense", "Cost of Goods Sold"],
  bill: ["Expense", "Other Expense", "Cost of Goods Sold"],
  deposit: ["Income", "Other Income"],
};

type RowState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "done"; account: string }
  | { kind: "stale" }
  | { kind: "error"; message: string };

export function UncategorizedList(props: {
  clients: { id: string; name: string }[];
  // See receipt-gaps.tsx — on one client's page the picker is a way out of the
  // page you are on, so it is not offered.
  lockedClient?: boolean;
  selectedClientId: string;
  from: string;
  to: string;
  txns: Txn[];
  considered: number;
  truncated: boolean;
  scanFailed: boolean;
  parkingAccounts: string[];
  accounts: Account[];
  engagements: { id: string; title: string }[];
  /** Transactions already put to the client, with their answer if it has come. */
  asked: { key: string; answer: string | null }[];
}) {
  const t = useTranslations("Quickbooks");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [engagementId, setEngagementId] = useState(
    props.engagements[0]?.id ?? "",
  );
  const [asking, setAsking] = useState(false);

  const askedMap = useMemo(
    () => new Map(props.asked.map((a) => [a.key, a.answer])),
    [props.asked],
  );
  // Only offer what has not been put to the client already. Asking the same
  // question twice is the fastest way to make someone stop reading their portal.
  const askable = useMemo(
    () => props.txns.filter((x) => !askedMap.has(keyOf(x))),
    [props.txns, askedMap],
  );

  const toggle = (k: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  async function ask() {
    if (selected.size === 0 || !engagementId) return;
    setAsking(true);
    try {
      const res = await fetch("/api/quickbooks/uncategorized/ask", {
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
        detail?: string;
      };
      if (!res.ok || !body.ok) {
        toast.error(body.detail ?? t("uncat_ask_failed"));
        return;
      }
      toast.success(t("uncat_asked", { count: body.created ?? 0 }));
      setSelected(new Set());
      startTransition(() => router.refresh());
    } catch {
      toast.error(t("uncat_ask_failed"));
    } finally {
      setAsking(false);
    }
  }

  const setParam = (key: string, value: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set(key, value);
    startTransition(() => router.replace(url.pathname + url.search));
  };

  const byType = useMemo(() => {
    const m = new Map<string, Account[]>();
    for (const a of props.accounts) {
      const k = a.type ?? "";
      const list = m.get(k);
      if (list) list.push(a);
      else m.set(k, [a]);
    }
    return m;
  }, [props.accounts]);

  async function apply(txn: Txn) {
    const k = keyOf(txn);
    const accountId = chosen[k];
    if (!accountId) return;
    setRows((r) => ({ ...r, [k]: { kind: "saving" } }));
    try {
      const res = await fetch("/api/quickbooks/uncategorized/categorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: props.selectedClientId,
          entity: txn.entity,
          txnId: txn.qboId,
          accountId,
        }),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        applied?: boolean;
        reason?: string;
        account?: string;
        detail?: string;
      };
      if (!res.ok || !body.ok) {
        setRows((r) => ({
          ...r,
          [k]: { kind: "error", message: body.detail ?? t("uncat_apply_failed") },
        }));
        return;
      }
      if (!body.applied) {
        // Somebody coded it first, or it is gone. Not an error — just no longer
        // ours to do.
        setRows((r) => ({ ...r, [k]: { kind: "stale" } }));
        return;
      }
      setRows((r) => ({
        ...r,
        [k]: { kind: "done", account: body.account ?? "" },
      }));
    } catch {
      setRows((r) => ({
        ...r,
        [k]: { kind: "error", message: t("uncat_apply_failed") },
      }));
    }
  }

  const doneCount = Object.values(rows).filter((r) => r.kind === "done").length;

  return (
    <div className="flex flex-col gap-5">
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
        <Note tone="warn">{t("uncat_scan_failed")}</Note>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {t("uncat_count", {
              txns: props.txns.length,
              considered: props.considered,
            })}
            {/* Which accounts were treated as "not coded". A scan that decides
                this silently is one nobody can check. */}
            {props.parkingAccounts.length > 0 && (
              <span className="ml-1">
                {t("uncat_parking", {
                  accounts: props.parkingAccounts.join(", "),
                })}
              </span>
            )}
          </p>
          {props.truncated && <Note tone="warn">{t("gaps_truncated")}</Note>}
        </>
      )}

      {!props.scanFailed &&
        props.txns.length === 0 &&
        (props.parkingAccounts.length === 0 ? (
          <Note tone="ok">{t("uncat_no_parking_accounts")}</Note>
        ) : (
          <div className="py-14 text-center">
            <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary/60 ring-1 ring-inset ring-border/50">
              <ReceiptIcon className="h-7 w-7 text-muted-foreground" />
            </div>
            <p className="mt-4 text-sm font-medium">{t("uncat_none_title")}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("uncat_none_body")}
            </p>
          </div>
        ))}

      {props.txns.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="w-9 py-2">
                  <input
                    type="checkbox"
                    checked={
                      askable.length > 0 && selected.size === askable.length
                    }
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
                <th className="py-2 font-medium">{t("gaps_col_date")}</th>
                <th className="py-2 font-medium">{t("uncat_col_what")}</th>
                <th className="py-2 font-medium">{t("uncat_col_parked")}</th>
                {/* pr-4 on the amount, because it is right-aligned and the
                    next heading is left-aligned: with no gap between them the
                    two run together and the header reads "AMOUNTCATEGORY". */}
                <th className="py-2 pr-4 text-right font-medium">
                  {t("gaps_col_amount")}
                </th>
                <th className="py-2 font-medium">{t("uncat_col_category")}</th>
              </tr>
            </thead>
            <tbody>
              {props.txns.map((txn) => {
                const k = keyOf(txn);
                const state = rows[k] ?? { kind: "idle" };
                const settled = state.kind === "done" || state.kind === "stale";
                const likely = LIKELY_TYPES[txn.entity];
                const wasAsked = askedMap.has(k);
                const answer = askedMap.get(k) ?? null;
                return (
                  <tr
                    key={k}
                    className={`border-b border-border/50 last:border-0 ${
                      settled ? "text-muted-foreground" : ""
                    }`}
                  >
                    <td className="py-2.5 align-top">
                      {wasAsked ? (
                        <Check
                          className="h-4 w-4 text-icon-emerald"
                          aria-label={t("uncat_already_asked")}
                        />
                      ) : (
                        <input
                          type="checkbox"
                          checked={selected.has(k)}
                          onChange={() => toggle(k)}
                          aria-label={txn.partyName ?? txn.qboId}
                        />
                      )}
                    </td>
                    <td className="py-2.5 align-top tabular-nums text-muted-foreground">
                      {txn.txnDate ?? "—"}
                    </td>
                    <td className="py-2.5 align-top">
                      <div>
                        {txn.partyName ?? (
                          <span className="text-muted-foreground">
                            {t("gaps_no_supplier")}
                          </span>
                        )}
                      </div>
                      {/* The bank descriptor. Very often the only clue there is,
                          so it is shown rather than summarised away. */}
                      {txn.memo && txn.memo !== txn.partyName && (
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {txn.memo}
                        </div>
                      )}
                      {/* The client's own words, next to the entry they explain
                          — which is the whole point of asking through the
                          checklist rather than over a message thread. */}
                      {answer ? (
                        <div className="mt-1.5 border-l-2 border-icon-emerald/40 pl-2 text-xs text-foreground/80">
                          {answer}
                        </div>
                      ) : wasAsked ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {t("uncat_waiting_on_client")}
                        </div>
                      ) : null}
                    </td>
                    <td className="py-2.5 align-top text-muted-foreground">
                      {txn.accountName ?? "—"}
                    </td>
                    <td className="py-2.5 pr-4 align-top text-right font-medium tabular-nums">
                      {txn.uncatAmt.toFixed(2)}
                      {txn.currency ? (
                        <span className="ml-1 text-xs font-normal text-muted-foreground">
                          {txn.currency}
                        </span>
                      ) : null}
                      {/* Only part of the transaction is uncoded — say so, or
                          the amount looks wrong against the client's books. */}
                      {Math.abs(txn.uncatAmt - txn.totalAmt) > 0.005 && (
                        <div className="text-xs font-normal text-muted-foreground">
                          {t("uncat_part_of", {
                            total: txn.totalAmt.toFixed(2),
                          })}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 align-top">
                      {state.kind === "done" ? (
                        <span className="flex items-center gap-1.5 text-icon-emerald">
                          <Check className="h-4 w-4 shrink-0" aria-hidden />
                          {state.account}
                        </span>
                      ) : state.kind === "stale" ? (
                        <span className="text-xs">{t("uncat_already_done")}</span>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            value={chosen[k] ?? ""}
                            aria-label={t("uncat_col_category")}
                            onChange={(e) =>
                              setChosen((c) => ({ ...c, [k]: e.target.value }))
                            }
                            className="h-8 max-w-[220px] rounded-md border border-input bg-background px-2 text-sm text-foreground"
                          >
                            <option value="">{t("uncat_pick")}</option>
                            <optgroup label={t("uncat_likely")}>
                              {likely.flatMap((type) =>
                                (byType.get(type) ?? []).map((a) => (
                                  <option key={a.id} value={a.id}>
                                    {a.name}
                                  </option>
                                )),
                              )}
                            </optgroup>
                            <optgroup label={t("uncat_other_accounts")}>
                              {props.accounts
                                .filter(
                                  (a) => !likely.includes(a.type ?? ""),
                                )
                                .map((a) => (
                                  <option key={a.id} value={a.id}>
                                    {a.name}
                                  </option>
                                ))}
                            </optgroup>
                          </select>
                          {chosen[k] && (
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={state.kind === "saving"}
                              onClick={() => apply(txn)}
                            >
                              {state.kind === "saving" && (
                                <Loader2
                                  className="mr-1.5 h-3.5 w-3.5 animate-spin"
                                  aria-hidden
                                />
                              )}
                              {t("uncat_apply")}
                            </Button>
                          )}
                          {state.kind === "error" && (
                            <span className="text-xs text-amber-600 dark:text-amber-500">
                              {state.message}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* The other way to clear a row: when the firm cannot tell what an entry
          was, only the client can. FLOATS once something is ticked — under the
          table it would be below the fold on any list worth acting on. */}
      <SelectionBar count={selected.size} onClear={() => setSelected(new Set())}>
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
              onClick={ask}
              disabled={asking}
            >
              {asking && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              )}
              {t("uncat_ask_button", { count: selected.size })}
            </Button>
          </>
        )}
      </SelectionBar>

      {/* Coded rows stay put rather than vanishing — an accountant working down
          a list needs to see what they have already done. The refresh is theirs
          to take when they want a clean list. */}
      {doneCount > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <Note tone="ok">{t("uncat_done", { count: doneCount })}</Note>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => startTransition(() => router.refresh())}
          >
            {t("uncat_refresh")}
          </Button>
        </div>
      )}
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
