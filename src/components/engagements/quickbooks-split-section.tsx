"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Check,
  ChevronsUpDown,
  Loader2,
  TriangleAlert,
  Split,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatCurrency, type AppLocale } from "@/lib/format";
import type { PickOption } from "./quickbooks-editable-field";
import type { ResolvedRef } from "@/lib/quickbooks/suggest";

type EditableLine = {
  description: string;
  amount: number;
  account: ResolvedRef | null;
};

// Split an EXPENSE receipt across multiple accounts (Stage: multi-line). Shows a
// "Split across accounts" toggle; when on, each read line item gets its own
// account picker. The whole line-account map is saved to the stable resolve
// endpoint on every change (the server shallow-replaces it). Read-only once the
// draft is approved/dismissed.
export function QuickbooksSplitSection({
  fileId,
  lines,
  split,
  accountOptions,
  locale,
  disabled = false,
}: {
  fileId: string;
  lines: EditableLine[];
  split: boolean;
  accountOptions: PickOption[];
  locale: AppLocale;
  disabled?: boolean;
}) {
  const t = useTranslations("Quickbooks");
  const router = useRouter();
  const [isSplit, setIsSplit] = useState(split);
  // Per-line account, seeded from the effective values (AI match or prior pick).
  const [accounts, setAccounts] = useState<(ResolvedRef | null)[]>(
    lines.map((l) => l.account),
  );
  const [pending, setPending] = useState(false);
  const [openLine, setOpenLine] = useState<number | null>(null);

  async function post(body: Record<string, unknown>) {
    setPending(true);
    try {
      const r = await fetch(`/api/quickbooks/suggestions/${fileId}/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const res = (await r.json().catch(() => null)) as { ok?: boolean } | null;
      if (res?.ok) router.refresh();
      return Boolean(res?.ok);
    } catch {
      return false;
    } finally {
      setPending(false);
    }
  }

  async function toggleSplit(next: boolean) {
    if (next === isSplit || pending) return;
    setIsSplit(next); // optimistic
    if (!(await post({ split: next }))) setIsSplit(!next); // revert
  }

  async function setLineAccount(i: number, ref: ResolvedRef | null) {
    const prev = accounts;
    const next = accounts.slice();
    next[i] = ref;
    setAccounts(next); // optimistic
    setOpenLine(null);
    // Send the FULL map so the server shallow-replace keeps every line.
    const map: Record<string, ResolvedRef | null> = {};
    next.forEach((a, idx) => (map[String(idx)] = a));
    if (!(await post({ lineAccounts: map }))) setAccounts(prev); // revert
  }

  return (
    <div className="px-3 pt-1.5">
      {/* Toggle row */}
      {disabled ? (
        isSplit ? (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Split className="h-3 w-3" aria-hidden="true" />
            {t("split_on")}
          </div>
        ) : null
      ) : (
        <button
          type="button"
          disabled={pending}
          aria-pressed={isSplit}
          onClick={() => toggleSplit(!isSplit)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-60",
            isSplit
              ? "bg-accent/15 text-accent"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Split className="h-3 w-3" aria-hidden="true" />
          {t("split_across_accounts")}
        </button>
      )}

      {/* The line items with per-line account pickers */}
      {isSplit && (
        <ul className="mt-1.5 space-y-1">
          {lines.map((l, i) => {
            const value = accounts[i];
            const empty = value == null;
            return (
              <li
                key={i}
                className="flex items-center gap-2 rounded-lg bg-muted/40 px-2.5 py-1.5"
              >
                <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                  {l.description}
                </span>
                <span className="shrink-0 text-[13px] tabular-nums text-muted-foreground">
                  {formatCurrency(l.amount, locale)}
                </span>
                <div className="w-[42%] shrink-0">
                  {disabled ? (
                    <div className="truncate text-right text-[13px] font-medium">
                      {empty ? "—" : value!.name}
                    </div>
                  ) : (
                    <Popover
                      open={openLine === i}
                      onOpenChange={(o) => setOpenLine(o ? i : null)}
                    >
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          disabled={pending}
                          aria-label={empty ? t("choose_account") : value!.name}
                          className={cn(
                            "flex w-full items-center gap-1 rounded-sm text-right text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
                            empty ? "text-warning" : "text-foreground",
                          )}
                        >
                          {empty && (
                            <TriangleAlert
                              className="h-3 w-3 shrink-0"
                              aria-hidden="true"
                            />
                          )}
                          <span className="min-w-0 flex-1 truncate font-medium">
                            {empty ? t("choose_account") : value!.name}
                          </span>
                          <ChevronsUpDown
                            className="h-3 w-3 shrink-0 opacity-50"
                            aria-hidden="true"
                          />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="min-w-[15rem] p-0" align="end">
                        <Command>
                          <CommandInput placeholder={t("pick_search")} />
                          <CommandList>
                            <CommandEmpty>{t("pick_empty")}</CommandEmpty>
                            <CommandGroup>
                              {value && (
                                <CommandItem
                                  value="__clear__"
                                  onSelect={() => setLineAccount(i, null)}
                                  className="text-muted-foreground"
                                >
                                  {t("pick_clear")}
                                </CommandItem>
                              )}
                              {accountOptions.map((o) => (
                                <CommandItem
                                  key={o.id}
                                  value={`${o.name} ${o.id}`}
                                  onSelect={() =>
                                    setLineAccount(i, {
                                      id: o.id,
                                      name: o.name,
                                    })
                                  }
                                >
                                  <Check
                                    className={cn(
                                      "size-4 shrink-0",
                                      value?.id === o.id
                                        ? "opacity-100"
                                        : "opacity-0",
                                    )}
                                  />
                                  <span className="truncate">{o.name}</span>
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  )}
                </div>
                {pending && openLine === i && (
                  <Loader2
                    className="h-3 w-3 shrink-0 animate-spin"
                    aria-hidden="true"
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
