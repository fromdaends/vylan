"use client";

// The journal-entry half of a payout statement's card.
//
// The accountant maps a handful of accounts ONCE (bank, sales, fees; the rest
// fold into sensible fallbacks), and this shows the resulting balanced journal
// entry — debits and credits, totals, the balance check — then lets them
// approve it.
//
// The entry is built by the PURE builder (lib/quickbooks/payout-journal.ts),
// which refuses outright when the payout's own figures don't add up. So this
// component never has to decide anything about correctness: it either has a
// balanced entry to show, or a plain reason it can't.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Check,
  ChevronsUpDown,
  CircleCheck,
  Loader2,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
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
import {
  buildPayoutJournal,
  requiredRolesFor,
  type AccountRef,
  type PayoutMapping,
  type PayoutRole,
} from "@/lib/quickbooks/payout-journal";
import type { PayoutFigures } from "@/lib/ai/payout-reconcile";
import {
  postPayoutJournalAction,
  setPayoutJournalAccountAction,
  setPayoutJournalStatusAction,
} from "@/app/actions/payout-journal";

export type PayoutJournalProps = {
  engagementId: string;
  uploadedFileId: string;
  figures: PayoutFigures;
  mapping: PayoutMapping;
  status: "draft" | "approved" | "posted" | "void";
  accounts: { id: string; name: string }[];
  locale: AppLocale;
  postedLink: string | null;
  postedRef: string | null;
  postError: string | null;
  // Memo + date inputs for the ledger entry, from the stored extraction.
  processor: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  payoutDate: string | null;
  provider: "quickbooks" | "xero";
};

// Every role the accountant can map, with the copy for each. Optional roles
// say what happens if left blank, so nobody wonders where the money went.
const ROLE_COPY: Record<
  PayoutRole,
  { en: string; fr: string; hintEn?: string; hintFr?: string }
> = {
  bank: {
    en: "Deposit account",
    fr: "Compte de dépôt",
    hintEn: "Where the net payout landed",
    hintFr: "Où le versement net a été déposé",
  },
  sales: {
    en: "Sales revenue",
    fr: "Revenus de ventes",
    hintEn: "Booked at gross",
    hintFr: "Comptabilisé au brut",
  },
  fees: {
    en: "Processing fees",
    fr: "Frais de traitement",
  },
  fee_tax: {
    en: "Tax on fees",
    fr: "Taxes sur les frais",
    hintEn: "Leave blank to include with fees",
    hintFr: "Laisser vide pour inclure aux frais",
  },
  refunds: {
    en: "Refunds",
    fr: "Remboursements",
    hintEn: "Leave blank to net against sales",
    hintFr: "Laisser vide pour soustraire des ventes",
  },
  adjustments: {
    en: "Chargebacks",
    fr: "Rétrofacturations",
    hintEn: "Leave blank to include with fees",
    hintFr: "Laisser vide pour inclure aux frais",
  },
};

function AccountPicker({
  value,
  options,
  placeholder,
  disabled,
  onPick,
}: {
  value: AccountRef | null;
  options: { id: string; name: string }[];
  placeholder: string;
  disabled: boolean;
  onPick: (a: AccountRef | null) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "flex w-full items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors",
            value
              ? "border-border/70 bg-background"
              : "border-warning/40 bg-warning/5",
            disabled
              ? "cursor-not-allowed opacity-60"
              : "hover:border-foreground/20",
          )}
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {value ? value.name : placeholder}
          </span>
          {!disabled && (
            <ChevronsUpDown
              className="size-3 shrink-0 text-muted-foreground"
              aria-hidden
            />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder={placeholder} className="h-9" />
          <CommandList>
            <CommandEmpty>—</CommandEmpty>
            <CommandGroup>
              {value && (
                <CommandItem
                  value="__clear__"
                  onSelect={() => {
                    onPick(null);
                    setOpen(false);
                  }}
                  className="text-muted-foreground"
                >
                  {placeholder}
                </CommandItem>
              )}
              {options.map((o) => (
                <CommandItem
                  key={o.id}
                  value={o.name}
                  onSelect={() => {
                    onPick(o);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "size-3.5",
                      value?.id === o.id ? "opacity-100" : "opacity-0",
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
  );
}

/**
 * Shown INSTEAD of the journal when there is nothing to map yet. The section
 * previously rendered nothing at all in these cases, which reads exactly like
 * a broken feature — the accountant sees the payout split and then a void
 * where the entry should be, with no clue why.
 */
export function PayoutJournalUnavailable({
  reason,
  locale,
}: {
  // no_connection = the client has no QuickBooks/Xero, so there are no
  // accounts to map. preparing = connected, but the draft row hasn't been
  // created yet (it is created on the next page load).
  reason: "no_connection" | "preparing";
  locale: AppLocale;
}) {
  const fr = locale === "fr";
  return (
    <div className="mt-2.5 border-t border-border/50 pt-2.5">
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-foreground/70">
        {fr ? "Écriture de journal" : "Journal entry"}
      </div>
      <p className="text-xs text-muted-foreground">
        {reason === "no_connection"
          ? fr
            ? "Connectez QuickBooks ou Xero pour ce client afin de créer l'écriture de journal automatiquement."
            : "Connect QuickBooks or Xero for this client to build the journal entry automatically."
          : fr
            ? "Préparation de l'écriture. Actualisez la page dans un instant."
            : "Preparing the entry. Refresh the page in a moment."}
      </p>
    </div>
  );
}

export function PayoutJournalSection({
  engagementId,
  uploadedFileId,
  figures,
  mapping: initialMapping,
  status,
  accounts,
  locale,
  postedLink,
  postedRef,
  postError,
  processor,
  periodStart,
  periodEnd,
  payoutDate,
  provider,
}: PayoutJournalProps) {
  const router = useRouter();
  const fr = locale === "fr";
  // Optimistic local mapping so a pick renders instantly; the server action
  // persists and revalidates behind it.
  const [mapping, setMapping] = useState<PayoutMapping>(initialMapping);
  const [saving, startSaving] = useTransition();
  const locked = status === "posted" || status === "approved";

  const built = buildPayoutJournal(figures, mapping);
  const needed = requiredRolesFor(figures);
  // Optional roles are only worth offering when they carry money.
  const optional: PayoutRole[] = (
    ["refunds", "fee_tax", "adjustments"] as PayoutRole[]
  ).filter((r) => {
    const v =
      r === "refunds"
        ? figures.refunds
        : r === "fee_tax"
          ? figures.feeTax
          : figures.adjustments;
    return typeof v === "number" && v !== 0;
  });
  const shown = [...needed, ...optional];

  function pick(role: PayoutRole, account: AccountRef | null) {
    const previous = mapping;
    setMapping((m) => ({ ...m, [role]: account }));
    startSaving(async () => {
      const res = await setPayoutJournalAccountAction({
        engagementId,
        uploadedFileId,
        role,
        account,
      });
      if (!res.ok) {
        setMapping(previous); // revert
        toast.error(fr ? "Impossible d'enregistrer." : "Couldn't save that.");
        return;
      }
      router.refresh();
    });
  }

  function setStatus(next: "draft" | "approved") {
    startSaving(async () => {
      const res = await setPayoutJournalStatusAction({
        engagementId,
        uploadedFileId,
        status: next,
      });
      if (!res.ok) {
        toast.error(fr ? "Impossible d'enregistrer." : "Couldn't save that.");
        return;
      }
      toast.success(
        next === "approved"
          ? fr
            ? "Écriture approuvée."
            : "Entry approved."
          : fr
            ? "Écriture rouverte."
            : "Entry reopened.",
      );
      router.refresh();
    });
  }

  function post() {
    startSaving(async () => {
      const res = await postPayoutJournalAction({
        engagementId,
        uploadedFileId,
        processor,
        periodStart,
        periodEnd,
        payoutDate,
      });
      if (res.ok) {
        toast.success(
          fr ? "Écriture comptabilisée." : "Entry posted to the ledger.",
        );
        router.refresh();
        return;
      }
      toast.error(
        res.error === "accounts_syncing"
          ? fr
            ? "Le plan comptable était encore en cours de synchronisation. Réessayez dans un instant."
            : "The chart of accounts was still syncing. Try again in a moment."
          : res.error === "missing_account_codes"
          ? fr
            ? `Ces comptes n'ont pas de code Xero : ${(res.accountNames ?? []).join(", ")}`
            : `These accounts have no Xero code: ${(res.accountNames ?? []).join(", ")}`
          : res.error === "needs_reconnect"
            ? fr
              ? `Reconnectez ${ledgerName} : la connexion a été autorisée avant la prise en charge des écritures de journal.`
              : `Reconnect ${ledgerName}: it was authorized before journal entries were supported.`
            : res.error === "not_connected"
              ? fr
                ? "La connexion comptable doit être rétablie."
                : "The bookkeeping connection needs reconnecting."
            : res.message ||
              (fr ? "La comptabilisation a échoué." : "Posting failed."),
      );
      router.refresh();
    });
  }

  const ledgerName = provider === "xero" ? "Xero" : "QuickBooks";

  return (
    <div className="mt-2.5 border-t border-border/50 pt-2.5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground/70">
          {fr ? "Écriture de journal" : "Journal entry"}
        </span>
        {status === "posted" ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
            <CircleCheck className="size-3" aria-hidden />
            {fr ? "Comptabilisée" : "Posted"}
          </span>
        ) : status === "approved" ? (
          <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {fr ? "Approuvée" : "Approved"}
          </span>
        ) : null}
      </div>

      {/* No accounts cached yet (a fresh connection syncs them in the
          background) — say so instead of showing empty pickers. */}
      {!locked && accounts.length === 0 && (
        <p className="mb-2 text-xs text-muted-foreground">
          {fr
            ? "Le plan comptable n'est pas encore synchronisé. Actualisez dans une minute."
            : "The chart of accounts hasn't synced yet. Refresh in a minute."}
        </p>
      )}

      {/* Account mapping. Hidden once approved — the picks are the record. */}
      {!locked && accounts.length > 0 && (
        <div className="mb-3 grid gap-2 sm:grid-cols-2">
          {shown.map((role) => (
            <div key={role} className="space-y-1">
              <div className="flex items-baseline gap-1.5">
                <span className="text-[11px] font-medium">
                  {fr ? ROLE_COPY[role].fr : ROLE_COPY[role].en}
                </span>
                {ROLE_COPY[role].hintEn && (
                  <span className="text-[10px] text-muted-foreground">
                    {fr ? ROLE_COPY[role].hintFr : ROLE_COPY[role].hintEn}
                  </span>
                )}
              </div>
              <AccountPicker
                value={mapping[role] ?? null}
                options={accounts}
                placeholder={fr ? "Choisir un compte" : "Choose an account"}
                disabled={saving}
                onPick={(a) => pick(role, a)}
              />
            </div>
          ))}
        </div>
      )}

      {/* The entry itself, or a plain reason there isn't one. */}
      {built.ok ? (
        <>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground">
                <th className="pb-1 text-left font-medium">
                  {fr ? "Compte" : "Account"}
                </th>
                <th className="pb-1 text-right font-medium">
                  {fr ? "Débit" : "Debit"}
                </th>
                <th className="pb-1 text-right font-medium">
                  {fr ? "Crédit" : "Credit"}
                </th>
              </tr>
            </thead>
            <tbody>
              {built.journal.lines.map((l, i) => (
                <tr key={`${l.account.id}-${i}`} className="border-t border-border/40">
                  <td className="py-1 pr-2">
                    <span className="block truncate">{l.account.name}</span>
                  </td>
                  <td className="py-1 text-right tabular-nums">
                    {l.debitCents > 0
                      ? formatCurrency(l.debitCents / 100, locale)
                      : ""}
                  </td>
                  <td className="py-1 text-right tabular-nums">
                    {l.creditCents > 0
                      ? formatCurrency(l.creditCents / 100, locale)
                      : ""}
                  </td>
                </tr>
              ))}
              <tr className="border-t border-border/60 font-medium">
                <td className="py-1 pr-2">{fr ? "Total" : "Total"}</td>
                <td className="py-1 text-right tabular-nums">
                  {formatCurrency(built.journal.totalDebitCents / 100, locale)}
                </td>
                <td className="py-1 text-right tabular-nums">
                  {formatCurrency(built.journal.totalCreditCents / 100, locale)}
                </td>
              </tr>
            </tbody>
          </table>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <CircleCheck className="size-3 text-emerald-500" aria-hidden />
              {fr ? "Débits et crédits balancent." : "Debits and credits balance."}
            </span>
            {status === "posted" && postedLink ? (
              <a
                href={postedLink}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] font-medium underline-offset-2 hover:underline"
              >
                {fr ? "Voir dans le grand livre" : "View in the ledger"}
              </a>
            ) : status === "approved" ? (
              <span className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setStatus("draft")}
                  disabled={saving}
                >
                  {fr ? "Rouvrir" : "Reopen"}
                </Button>
                <Button size="sm" onClick={post} disabled={saving}>
                  {saving && <Loader2 className="animate-spin" />}
                  {fr ? `Comptabiliser dans ${ledgerName}` : `Post to ${ledgerName}`}
                </Button>
              </span>
            ) : (
              <Button
                size="sm"
                onClick={() => setStatus("approved")}
                disabled={saving}
              >
                {saving && <Loader2 className="animate-spin" />}
                {fr ? "Approuver l'écriture" : "Approve entry"}
              </Button>
            )}
          </div>
          {status === "posted" && postedRef && (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {fr
                ? `Écriture ${ledgerName} nº ${postedRef}.`
                : `${ledgerName} entry #${postedRef}.`}
            </p>
          )}
          {status === "approved" && postError && (
            <p className="mt-1.5 text-[11px] text-warning">
              {fr ? "Dernière tentative : " : "Last attempt: "}
              {postError}
            </p>
          )}
        </>
      ) : (
        <div className="flex items-start gap-1.5 text-xs">
          <TriangleAlert
            className="mt-px size-3.5 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <span className="text-muted-foreground">
            {built.reason === "does_not_reconcile"
              ? fr
                ? "Les montants du versement ne balancent pas — corrigez cet écart avant de créer l'écriture."
                : "The payout's own figures don't add up — resolve that difference before building an entry."
              : built.reason === "nothing_to_post"
                ? fr
                  ? "Rien à comptabiliser sur ce relevé."
                  : "Nothing to post on this statement."
                : fr
                  ? "Choisissez les comptes ci-dessus pour voir l'écriture."
                  : "Choose the accounts above to see the entry."}
          </span>
        </div>
      )}
    </div>
  );
}
